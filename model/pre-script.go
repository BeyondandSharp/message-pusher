package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/dop251/goja"
)

// PreScriptTimeout 限制前置脚本的最长执行时间。脚本里出现死循环时会被强制中断，
// 不会把当前请求（乃至服务）卡住。
const PreScriptTimeout = 3 * time.Second

// PreScriptSendVar 是前置脚本里控制「本次是否真的发送消息」的变量名，默认值为 true。
const PreScriptSendVar = "__msg_send__"

// preScriptSendProbe 会被追加到脚本末尾：它在脚本自身的作用域里创建一个闭包，返回当前 __msg_send__ 的取值。
// 用这种方式读取而不是 vm.Get，是因为顶层用 let/const 声明的同名变量只存在于脚本的词法作用域里，
// 不会成为全局对象属性，用 vm.Get 会读不到。
const preScriptSendProbe = "\n;(function () { return typeof " + PreScriptSendVar + " === 'undefined' ? true : " + PreScriptSendVar + "; })"

// RunPreScript 执行 Webhook 的前置脚本。
//
// 脚本需要定义 main(json) 函数：入参是请求体的 JSON（已解析为对象、数组或标量），
// 返回值会作为新的请求数据，交给后续的提取规则（gjson）和构建规则使用。
//
// 脚本里还可以用全局变量 __msg_send__ 控制本次是否发送消息：默认为 true；设为假值
// （false / 0 / '' / null 等）时不发送消息，只把结果返回给调用方。
// __msg_send__ 是在 main 执行之后读取的，所以写在顶层或者 main 内部都生效。
// 返回值里的第二个值就是它。
//
// goja 是纯 Go 的 JavaScript 解释器，这里没有向运行时注入任何宿主能力
// （没有 require、没有文件、没有网络），因此脚本只能在传入的 JSON 上做纯计算。
func RunPreScript(script string, input interface{}) (interface{}, bool, error) {
	if strings.TrimSpace(script) == "" {
		return nil, true, errors.New("前置脚本为空")
	}
	vm := goja.New()
	timer := time.AfterFunc(PreScriptTimeout, func() {
		vm.Interrupt(fmt.Sprintf("前置脚本执行超过 %s，已中断（请检查脚本中是否有死循环）", PreScriptTimeout))
	})
	defer func() {
		timer.Stop()
		// 定时器可能在脚本刚执行完之后才触发，这里清掉中断标记，避免影响后续（虽然本 vm 会被丢弃）
		vm.ClearInterrupt()
	}()
	// 先给 __msg_send__ 一个默认值：脚本里既能直接读取，也能直接赋值覆盖
	if err := vm.Set(PreScriptSendVar, true); err != nil {
		return nil, true, err
	}
	probeValue, err := vm.RunString(script + preScriptSendProbe)
	if err != nil {
		return nil, true, err
	}
	// 末尾探针求值得到的闭包，用来在 main 执行完之后读取 __msg_send__
	sendFn, ok := goja.AssertFunction(probeValue)
	if !ok {
		return nil, true, errors.New("前置脚本内部错误：无法读取 " + PreScriptSendVar + " 变量")
	}
	mainFn, ok := goja.AssertFunction(vm.Get("main"))
	if !ok {
		return nil, true, errors.New("前置脚本需要定义一个 main(json) 函数")
	}
	result, err := mainFn(goja.Undefined(), vm.ToValue(input))
	if err != nil {
		return nil, true, err
	}
	sendValue, err := sendFn(goja.Undefined())
	if err != nil {
		return nil, true, err
	}
	shouldSend := sendValue.ToBoolean()
	// 跳过发送时返回值不会被用到，所以允许 main 不返回任何东西
	if shouldSend && goja.IsUndefined(result) {
		return nil, true, errors.New("前置脚本的 main(json) 没有返回值（请用 return 返回处理后的数据）")
	}
	return result.Export(), shouldSend, nil
}
