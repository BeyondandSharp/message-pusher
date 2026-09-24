package model

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func decodeTestJSON(t *testing.T, s string) interface{} {
	t.Helper()
	var value interface{}
	decoder := json.NewDecoder(strings.NewReader(s))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		t.Fatalf("非法的测试 JSON %q：%v", s, err)
	}
	return value
}

func TestRenderWebhookConstructRule(t *testing.T) {
	tests := []struct {
		name            string
		rule            string
		variables       map[string]string
		wantTitle       string
		wantDesc        string
		wantURL         string
		wantContent     string
		wantContentJSON string // 非空时按 JSON 结构比较 content，否则按字符串精确比较
		wantErr         bool
	}{
		{
			name: "content 为嵌套对象（飞书卡片模板）",
			rule: `{
    "title": "$title",
    "content": {
        "type": "template",
        "data": {
            "template_id": "AAqT4DxII5iEU",
            "template_variable": {
                "title": "$title",
                "content": "$content"
            }
        }
    }
}`,
			variables: map[string]string{
				"title":   "今日提醒",
				"content": "第一行\n第二行",
			},
			wantTitle: "今日提醒",
			wantContentJSON: `{
  "type": "template",
  "data": {
    "template_id": "AAqT4DxII5iEU",
    "template_variable": {
      "title": "今日提醒",
      "content": "第一行\n第二行"
    }
  }
}`,
		},
		{
			name: "纯字符串字段保持原有行为",
			rule: `{
  "title": "$title",
  "description": "描述信息：$description",
  "content": "内容：$content",
  "url": "https://example.com/$title"
}`,
			variables: map[string]string{
				"title":       "标题",
				"description": "描述",
				"content":     "内容",
			},
			wantTitle:   "标题",
			wantDesc:    "描述信息：描述",
			wantURL:     "https://example.com/标题",
			wantContent: "内容：内容",
		},
		{
			name: "变量值含引号与换行也不会破坏 JSON",
			rule: `{"title": "$title", "content": "$content"}`,
			variables: map[string]string{
				"title":   `标题"带引号"`,
				"content": "第一行\n第二行",
			},
			wantTitle:   `标题"带引号"`,
			wantContent: "第一行\n第二行",
		},
		{
			name: "数组中的变量也会被替换",
			rule: `{"content": {"elements": [{"text": "$content"}, {"text": "固定文案"}]}}`,
			variables: map[string]string{
				"content": "动态文案",
			},
			wantContentJSON: `{"elements": [{"text": "动态文案"}, {"text": "固定文案"}]}`,
		},
		{
			name: "长变量名优先，$title 不误伤 $title_extra",
			rule: `{"title": "$title_extra", "content": "$title"}`,
			variables: map[string]string{
				"title":       "短",
				"title_extra": "长",
			},
			wantTitle:   "长",
			wantContent: "短",
		},
		{
			name:        "未定义的变量保持原样",
			rule:        `{"content": "$unknown"}`,
			variables:   map[string]string{"title": "t"},
			wantContent: "$unknown",
		},
		{
			name:            "数字与布尔值保持类型",
			rule:            `{"content": {"count": 1234567890123456789, "ok": true}}`,
			variables:       map[string]string{},
			wantContentJSON: `{"count": 1234567890123456789, "ok": true}`,
		},
		{
			name:    "构建规则不是合法 JSON",
			rule:    `{"title": "$title"`,
			wantErr: true,
		},
		{
			name:    "构建规则是 JSON 数组",
			rule:    `[1, 2, 3]`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule, err := RenderWebhookConstructRule(tt.rule, tt.variables)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("期望返回错误，实际得到 %+v", rule)
				}
				return
			}
			if err != nil {
				t.Fatalf("未预期的错误：%v", err)
			}
			if got := WebhookConstructRuleString(rule.Title); got != tt.wantTitle {
				t.Fatalf("title 不匹配：got %q, want %q", got, tt.wantTitle)
			}
			if got := WebhookConstructRuleString(rule.Description); got != tt.wantDesc {
				t.Fatalf("description 不匹配：got %q, want %q", got, tt.wantDesc)
			}
			if got := WebhookConstructRuleString(rule.URL); got != tt.wantURL {
				t.Fatalf("url 不匹配：got %q, want %q", got, tt.wantURL)
			}
			gotContent := WebhookConstructRuleString(rule.Content)
			if tt.wantContentJSON != "" {
				got := decodeTestJSON(t, gotContent)
				want := decodeTestJSON(t, tt.wantContentJSON)
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("content 不匹配：\n got: %s\nwant: %s", gotContent, tt.wantContentJSON)
				}
				return
			}
			if gotContent != tt.wantContent {
				t.Fatalf("content 不匹配：got %q, want %q", gotContent, tt.wantContent)
			}
		})
	}
}

func TestWebhookConstructRuleString(t *testing.T) {
	value, err := RenderWebhookConstructRule(`{"content": {"a": 1}}`, map[string]string{})
	if err != nil {
		t.Fatalf("未预期的错误：%v", err)
	}
	if got := WebhookConstructRuleString(value.Content); got != `{"a":1}` {
		t.Fatalf("对象应被序列化为 JSON 文本，实际为 %q", got)
	}
	if got := WebhookConstructRuleString(nil); got != "" {
		t.Fatalf("nil 应转换为空字符串，实际为 %q", got)
	}
	if got := WebhookConstructRuleString("文本"); got != "文本" {
		t.Fatalf("字符串应原样返回，实际为 %q", got)
	}
}
