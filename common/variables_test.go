package common

import "testing"

func TestRenderTemplateBasicVariables(t *testing.T) {
	variables := map[string]interface{}{
		"title":       "短",
		"title_extra": "长",
		"content":     "正文",
		"to":          "someone",
	}
	got := RenderTemplate(`{"a":"$title_extra","b":"$title","c":"$content","d":"$to"}`, variables)
	want := `{"a":"长","b":"短","c":"正文","d":"someone"}`
	if got != want {
		t.Fatalf("渲染结果不匹配：\n got: %s\nwant: %s", got, want)
	}
}

func TestRenderTemplateNestedContent(t *testing.T) {
	content := `{
		"type": "template",
		"data": {
			"template_id": "AAqT4DxII5iEU",
			"template_variable": {
				"title": "IP: IP更新",
				"content": ""
			}
		},
		"items": [{"name": "first"}]
	}`
	variables := map[string]interface{}{
		"title":        "IP更新",
		"content":      content,
		"content_test": "mmmmmsg",
	}
	template := `{"title":"$title","content_test":"$content_test","nested":"$content.data.template_variable.title","empty":"$content.data.template_variable.content","array":"$content.items.0.name","template_id":"$content.data.template_id"}`
	got := RenderTemplate(template, variables)
	want := `{"title":"IP更新","content_test":"mmmmmsg","nested":"IP: IP更新","empty":"","array":"first","template_id":"AAqT4DxII5iEU"}`
	if got != want {
		t.Fatalf("渲染结果不匹配：\n got: %s\nwant: %s", got, want)
	}
}

func TestRenderTemplateNestedObjectVariable(t *testing.T) {
	variables := map[string]interface{}{
		"payload": map[string]interface{}{
			"data": map[string]interface{}{
				"count": int64(42),
				"ok":    true,
			},
		},
	}
	got := RenderTemplate(`{"count":"$payload.data.count","ok":"$payload.data.ok"}`, variables)
	want := `{"count":"42","ok":"true"}`
	if got != want {
		t.Fatalf("渲染结果不匹配：\n got: %s\nwant: %s", got, want)
	}
}

func TestRenderTemplateUnknownAndInvalidPaths(t *testing.T) {
	variables := map[string]interface{}{
		"content": `{"a":1}`,
		"title":   "标题",
	}
	got := RenderTemplate(`{"unknown":"$unknown","missing":"$content.b.c","plain":"$title"}`, variables)
	want := `{"unknown":"$unknown","missing":"$content.b.c","plain":"标题"}`
	if got != want {
		t.Fatalf("未定义变量/路径应原样保留：\n got: %s\nwant: %s", got, want)
	}
}

func TestRenderTemplateEscapesValues(t *testing.T) {
	variables := map[string]interface{}{
		"content": "第一行\n第二行 \"引号\" \\反斜杠",
	}
	got := RenderTemplate(`{"content":"$content"}`, variables)
	want := `{"content":"第一行\n第二行 \"引号\" \\反斜杠"}`
	if got != want {
		t.Fatalf("替换值未正确转义：\n got: %s\nwant: %s", got, want)
	}
}

func TestRenderTemplateVariableFollowedByPeriod(t *testing.T) {
	variables := map[string]interface{}{"title": "标题"}
	if got := RenderTemplate(`"$title."`, variables); got != `"标题."` {
		t.Fatalf("变量后的句号应作为普通文本保留，实际为 %q", got)
	}
	if got := RenderTemplate(`"https://example.com/$title.html"`, variables); got != `"https://example.com/标题.html"` {
		t.Fatalf("普通字符串后的后缀应保留，实际为 %q", got)
	}
}

func TestRenderTemplateInvalidPathForJSONValue(t *testing.T) {
	variables := map[string]interface{}{
		"content": `{"a":{"b":"c"}}`,
	}
	if got := RenderTemplate(`{"x":"$content.a.missing"}`, variables); got != `{"x":"$content.a.missing"}` {
		t.Fatalf("JSON 值的错误路径应原样保留，实际为 %q", got)
	}
}

func TestRenderTemplateUndefinedLongerVariableStaysIntact(t *testing.T) {
	variables := map[string]interface{}{
		"content": `{"a":1}`,
		"title":   "标题",
	}
	if got := RenderTemplate(`{"x":"$content_test"}`, variables); got != `{"x":"$content_test"}` {
		t.Fatalf("未定义的更长变量名不应被截断替换，实际为 %q", got)
	}
	if got := RenderTemplate(`"$titleSuffix"`, variables); got != `"$titleSuffix"` {
		t.Fatalf("变量名后紧跟标识符字符时应保留原样，实际为 %q", got)
	}
	// 中文/标点不属于 ASCII 标识符，仍按变量 + 普通文本处理。
	if got := RenderTemplate(`"$title更新"`, variables); got != `"标题更新"` {
		t.Fatalf("变量后接中文时应正常替换，实际为 %q", got)
	}
}

func TestRenderTemplateDottedVariableNameWins(t *testing.T) {
	variables := map[string]interface{}{
		"a":   map[string]interface{}{"b": "路径"},
		"a.b": "变量名",
	}
	if got := RenderTemplate("$a.b", variables); got != "变量名" {
		t.Fatalf("带点的变量名应优先于路径解析，实际为 %q", got)
	}
}

func TestReplaceEscapesJSONString(t *testing.T) {
	got := Replace(`{"a":"$x"}`, "$x", "引号\"换行\n", -1)
	want := `{"a":"引号\"换行\n"}`
	if got != want {
		t.Fatalf("Replace 转义结果不匹配：\n got: %s\nwant: %s", got, want)
	}
}
