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

// RunPreScript 执行 Webhook 的前置脚本。
//
// 脚本需要定义 main(json) 函数：入参是请求体的 JSON（已解析为对象、数组或标量），
// 返回值会作为新的请求数据，交给后续的提取规则（gjson）和构建规则使用。
//
// goja 是纯 Go 的 JavaScript 解释器，这里没有向运行时注入任何宿主能力
// （没有 require、没有文件、没有网络），因此脚本只能在传入的 JSON 上做纯计算。
func RunPreScript(script string, input interface{}) (interface{}, error) {
	if strings.TrimSpace(script) == "" {
		return nil, errors.New("前置脚本为空")
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
	if _, err := vm.RunString(script); err != nil {
		return nil, err
	}
	mainFn, ok := goja.AssertFunction(vm.Get("main"))
	if !ok {
		return nil, errors.New("前置脚本需要定义一个 main(json) 函数")
	}
	result, err := mainFn(goja.Undefined(), vm.ToValue(input))
	if err != nil {
		return nil, err
	}
	if goja.IsUndefined(result) {
		return nil, errors.New("前置脚本的 main(json) 没有返回值（请用 return 返回处理后的数据）")
	}
	return result.Export(), nil
}
