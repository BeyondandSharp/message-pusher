package model

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

func mustJSON(t *testing.T, text string) interface{} {
	t.Helper()
	var value interface{}
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		t.Fatalf("不是合法的 JSON：%s（%v）", text, err)
	}
	return value
}

func runPreScriptToString(t *testing.T, script string, input interface{}) (string, error) {
	t.Helper()
	out, _, err := RunPreScript(script, input)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(out)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// runPreScriptSend 只关心第二项返回值：本次是否发送消息
func runPreScriptSend(t *testing.T, script string) (bool, error) {
	t.Helper()
	_, __msg_send__, err := RunPreScript(script, map[string]interface{}{"a": 1})
	return __msg_send__, err
}

func TestRunPreScript(t *testing.T) {
	cases := []struct {
		name   string
		script string
		input  string
		want   string
	}{
		{
			name: "改写字段：把请求里的字段映射成提取规则要用的结构",
			script: `function main(json) {
  return {
    title: json.attr1,
    description: json.attr2.sub_attr,
    content: json.attr3
  };
}`,
			input: `{"attr1":"hello","attr2":{"sub_attr":"world"},"attr3":"body"}`,
			want:  `{"title":"hello","description":"world","content":"body"}`,
		},
		{
			name: "默认脚本式的浅拷贝：处理之后结果与输入一致",
			script: `function main(json) {
  if (Array.isArray(json)) {
    return json.slice();
  }
  if (json !== null && typeof json === 'object') {
    return Object.assign({}, json);
  }
  return json;
}`,
			input: `{"a":1,"b":[1,2,{"c":true}],"d":null,"e":"x"}`,
			want:  `{"a":1,"b":[1,2,{"c":true}],"d":null,"e":"x"}`,
		},
		{
			name:   "输入是数组时也能处理",
			script: `function main(json) { return json.map(function (item) { return item.name; }); }`,
			input:  `[{"name":"a"},{"name":"b"}]`,
			want:   `["a","b"]`,
		},
		{
			name:   "返回标量",
			script: `function main(json) { return json.a + 1; }`,
			input:  `{"a":41}`,
			want:   `42`,
		},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got, err := runPreScriptToString(t, tt.script, mustJSON(t, tt.input))
			if err != nil {
				t.Fatalf("执行失败：%v", err)
			}
			// 用解析后的值比较，避免键顺序不同导致误判
			if !reflect.DeepEqual(mustJSON(t, got), mustJSON(t, tt.want)) {
				t.Errorf("结果不符\n got: %s\nwant: %s", got, tt.want)
			}
		})
	}
}

func TestRunPreScriptSendFlag(t *testing.T) {
	cases := []struct {
		name   string
		script string
		want   bool
	}{
		{
			name:   "不涉及 __msg_send__：默认为 true",
			script: `function main(json) { return json; }`,
			want:   true,
		},
		{
			name: "main 内隐式赋值 false",
			script: `function main(json) {
  if (json.a === 1) { __msg_send__ = false; }
  return json;
}`,
			want: false,
		},
		{
			name: "顶层 var __msg_send__ = false",
			script: `var __msg_send__ = false;
function main(json) { return json; }`,
			want: false,
		},
		{
			name: "顶层 let __msg_send__ = false",
			script: `let __msg_send__ = false;
function main(json) { return json; }`,
			want: false,
		},
		{
			name: "顶层 const __msg_send__ = false",
			script: `const __msg_send__ = false;
function main(json) { return json; }`,
			want: false,
		},
		{
			name:   "显式 __msg_send__ = true",
			script: `function main(json) { __msg_send__ = true; return json; }`,
			want:   true,
		},
		{
			name:   "main 内先设 false 再设回 true",
			script: `function main(json) { __msg_send__ = false; __msg_send__ = true; return json; }`,
			want:   true,
		},
		{
			name:   "假值 0 视为不发送",
			script: `function main(json) { __msg_send__ = 0; return json; }`,
			want:   false,
		},
		{
			name:   "空字符串视为不发送",
			script: `function main(json) { __msg_send__ = ''; return json; }`,
			want:   false,
		},
		{
			name:   "null 视为不发送",
			script: `function main(json) { __msg_send__ = null; return json; }`,
			want:   false,
		},
		{
			name:   "非空字符串按 JS 真值处理，仍然发送",
			script: `function main(json) { __msg_send__ = 'no'; return json; }`,
			want:   true,
		},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got, err := runPreScriptSend(t, tt.script)
			if err != nil {
				t.Fatalf("执行失败：%v", err)
			}
			if got != tt.want {
				t.Errorf("__msg_send__ 应为 %v，实际为 %v", tt.want, got)
			}
		})
	}
}

func TestRunPreScriptWithoutReturn(t *testing.T) {
	// 跳过发送时返回值用不到，允许 main 什么都不返回
	__msg_send__, err := runPreScriptSend(t, `function main(json) { __msg_send__ = false; }`)
	if err != nil {
		t.Fatalf("跳过发送时不应报错：%v", err)
	}
	if __msg_send__ {
		t.Errorf("__msg_send__ 应为 false")
	}
	// 需要发送时仍然要求有返回值
	if _, err := runPreScriptSend(t, `function main(json) { var a = 1; }`); err == nil {
		t.Errorf("需要发送时应报「没有返回值」")
	} else if !strings.Contains(err.Error(), "没有返回值") {
		t.Errorf("错误信息应提示没有返回值，实际为 %q", err.Error())
	}
}

func TestRunPreScriptErrors(t *testing.T) {	cases := []struct {
		name    string
		script  string
		wantErr string
	}{
		{name: "空脚本", script: "   ", wantErr: "前置脚本为空"},
		{name: "语法错误", script: "function main(json) {", wantErr: ""},
		{name: "没有定义 main", script: "var a = 1;", wantErr: "main(json)"},
		{
			name:    "main 没有返回值",
			script:  "function main(json) { var a = 1; }",
			wantErr: "没有返回值",
		},
		{
			name:    "运行时抛错",
			script:  "function main(json) { return json.a.b.c; }",
			wantErr: "",
		},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := RunPreScript(tt.script, map[string]interface{}{"a": 1})
			if err == nil {
				t.Fatalf("期望报错，但执行成功了")
			}
			if tt.wantErr != "" && !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("错误信息应包含 %q，实际为 %q", tt.wantErr, err.Error())
			}
		})
	}
}

func TestRunPreScriptTimeout(t *testing.T) {
	start := time.Now()
	_, _, err := RunPreScript("function main(json) { while (true) {} }", map[string]interface{}{})
	elapsed := time.Since(start)
	if err == nil {
		t.Fatalf("死循环脚本应该被中断")
	}
	if elapsed > PreScriptTimeout+2*time.Second {
		t.Errorf("中断耗时过长：%s", elapsed)
	}
	t.Logf("死循环脚本在 %s 后被中断：%v", elapsed, err)
}
