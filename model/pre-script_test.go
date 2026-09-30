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
	out, err := RunPreScript(script, input)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(out)
	if err != nil {
		return "", err
	}
	return string(data), nil
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

func TestRunPreScriptErrors(t *testing.T) {
	cases := []struct {
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
			_, err := RunPreScript(tt.script, map[string]interface{}{"a": 1})
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
	_, err := RunPreScript("function main(json) { while (true) {} }", map[string]interface{}{})
	elapsed := time.Since(start)
	if err == nil {
		t.Fatalf("死循环脚本应该被中断")
	}
	if elapsed > PreScriptTimeout+2*time.Second {
		t.Errorf("中断耗时过长：%s", elapsed)
	}
	t.Logf("死循环脚本在 %s 后被中断：%v", elapsed, err)
}
