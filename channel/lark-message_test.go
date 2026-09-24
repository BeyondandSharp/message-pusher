package channel

import (
	"encoding/json"
	"message-pusher/model"
	"reflect"
	"testing"
)

func larkTestJSON(t *testing.T, s string) interface{} {
	t.Helper()
	var value interface{}
	if err := json.Unmarshal([]byte(s), &value); err != nil {
		t.Fatalf("测试用例中的 JSON 非法 %q：%v", s, err)
	}
	return value
}

func TestBuildLarkAppMessage(t *testing.T) {
	tests := []struct {
		name        string
		message     model.Message
		wantMsgType string
		wantContent string
		wantErr     bool
	}{
		{
			name:        "不传 msg_type 且只有 description：文本消息（历史行为）",
			message:     model.Message{Description: "hello"},
			wantMsgType: "text",
			wantContent: `{"text":"hello"}`,
		},
		{
			name:        "不传 msg_type 且 description 与 content 都有：description 优先（历史行为）",
			message:     model.Message{Description: "hello", Content: "**hi**"},
			wantMsgType: "text",
			wantContent: `{"text":"hello"}`,
		},
		{
			name:        "不传 msg_type 且只有 content：交互卡片（历史行为）",
			message:     model.Message{Content: "**hi**"},
			wantMsgType: "interactive",
			wantContent: `{"config":{"wide_screen_mode":true,"enable_forward":true},"elements":[{"tag":"div","text":{"tag":"lark_md","content":"**hi**"}}]}`,
		},
		{
			name:    "不传 msg_type 且内容为空：报错",
			message: model.Message{},
			wantErr: true,
		},
		{
			name:        "text：description 作为正文",
			message:     model.Message{MsgType: "text", Description: "hello"},
			wantMsgType: "text",
			wantContent: `{"text":"hello"}`,
		},
		{
			name:        "text：description 为空时回退到 content",
			message:     model.Message{MsgType: "text", Content: "hello"},
			wantMsgType: "text",
			wantContent: `{"text":"hello"}`,
		},
		{
			name:        "text：大小写与空格归一化",
			message:     model.Message{MsgType: "  TEXT  ", Description: "hello"},
			wantMsgType: "text",
			wantContent: `{"text":"hello"}`,
		},
		{
			name:    "text：内容为空报错",
			message: model.Message{MsgType: "text"},
			wantErr: true,
		},
		{
			name:        "post：zh_cn 写法原样透传",
			message:     model.Message{MsgType: "post", Content: `{"zh_cn":{"title":"T","content":[[{"tag":"text","text":"hi"}]]}}`},
			wantMsgType: "post",
			wantContent: `{"zh_cn":{"title":"T","content":[[{"tag":"text","text":"hi"}]]}}`,
		},
		{
			name:        "post：带 post 包裹的写法会被拆掉包裹",
			message:     model.Message{MsgType: "post", Content: `{"post":{"zh_cn":{"title":"T","content":[[{"tag":"text","text":"hi"}]]}}}`},
			wantMsgType: "post",
			wantContent: `{"zh_cn":{"title":"T","content":[[{"tag":"text","text":"hi"}]]}}`,
		},
		{
			name:        "post：只有 title 与 content 的简写会补上 zh_cn",
			message:     model.Message{MsgType: "post", Content: `{"title":"T","content":[[{"tag":"text","text":"hi"}]]}`},
			wantMsgType: "post",
			wantContent: `{"zh_cn":{"title":"T","content":[[{"tag":"text","text":"hi"}]]}}`,
		},
		{
			name:        "post：en_us 写法原样透传",
			message:     model.Message{MsgType: "post", Content: `{"en_us":{"title":"T","content":[[{"tag":"text","text":"hi"}]]}}`},
			wantMsgType: "post",
			wantContent: `{"en_us":{"title":"T","content":[[{"tag":"text","text":"hi"}]]}}`,
		},
		{
			name:    "post：content 不是 JSON 报错",
			message: model.Message{MsgType: "post", Content: "not json"},
			wantErr: true,
		},
		{
			name:    "post：content 是 JSON 数组报错",
			message: model.Message{MsgType: "post", Content: `[1,2,3]`},
			wantErr: true,
		},
		{
			name:    "post：缺少 content 段落数组报错",
			message: model.Message{MsgType: "post", Content: `{"zh_cn":{"title":"T"}}`},
			wantErr: true,
		},
		{
			name:    "post：content 为空报错",
			message: model.Message{MsgType: "post"},
			wantErr: true,
		},
		{
			name:        "interactive：合法 JSON 对象原样作为卡片",
			message:     model.Message{MsgType: "interactive", Content: `{"schema":"2.0","body":{"elements":[]}}`},
			wantMsgType: "interactive",
			wantContent: `{"schema":"2.0","body":{"elements":[]}}`,
		},
		{
			name:        "interactive：普通 Markdown 构建卡片 1.0",
			message:     model.Message{MsgType: "interactive", Content: "**hi**"},
			wantMsgType: "interactive",
			wantContent: `{"config":{"wide_screen_mode":true,"enable_forward":true},"elements":[{"tag":"div","text":{"tag":"lark_md","content":"**hi**"}}]}`,
		},
		{
			name:    "interactive：content 为空报错",
			message: model.Message{MsgType: "interactive"},
			wantErr: true,
		},
		{
			name:        "image：裸 key 会自动包装",
			message:     model.Message{MsgType: "image", Content: "img_xxx"},
			wantMsgType: "image",
			wantContent: `{"image_key":"img_xxx"}`,
		},
		{
			name:        "image：JSON 对象原样透传",
			message:     model.Message{MsgType: "image", Content: `{"image_key":"img_xxx"}`},
			wantMsgType: "image",
			wantContent: `{"image_key":"img_xxx"}`,
		},
		{
			name:    "image：content 为空报错",
			message: model.Message{MsgType: "image"},
			wantErr: true,
		},
		{
			name:        "share_chat：自建应用的键是 chat_id",
			message:     model.Message{MsgType: "share_chat", Content: "oc_xxx"},
			wantMsgType: "share_chat",
			wantContent: `{"chat_id":"oc_xxx"}`,
		},
		{
			name:        "share_user：自建应用的键是 user_id",
			message:     model.Message{MsgType: "share_user", Content: "ou_xxx"},
			wantMsgType: "share_user",
			wantContent: `{"user_id":"ou_xxx"}`,
		},
		{
			name:        "audio：裸 key 包装为 file_key",
			message:     model.Message{MsgType: "audio", Content: "file_v2_xxx"},
			wantMsgType: "audio",
			wantContent: `{"file_key":"file_v2_xxx"}`,
		},
		{
			name:        "media：JSON 对象原样透传（可带封面 image_key）",
			message:     model.Message{MsgType: "media", Content: `{"file_key":"file_v2_xxx","image_key":"img_v2_xxx"}`},
			wantMsgType: "media",
			wantContent: `{"file_key":"file_v2_xxx","image_key":"img_v2_xxx"}`,
		},
		{
			name:        "file：裸 key 包装为 file_key",
			message:     model.Message{MsgType: "file", Content: "file_v2_xxx"},
			wantMsgType: "file",
			wantContent: `{"file_key":"file_v2_xxx"}`,
		},
		{
			name:        "sticker：裸 key 包装为 file_key",
			message:     model.Message{MsgType: "sticker", Content: "file_v2_xxx"},
			wantMsgType: "sticker",
			wantContent: `{"file_key":"file_v2_xxx"}`,
		},
		{
			name:        "未知类型：合法 JSON 对象原样透传",
			message:     model.Message{MsgType: "systemwarning", Content: `{"content":"x"}`},
			wantMsgType: "systemwarning",
			wantContent: `{"content":"x"}`,
		},
		{
			name:    "未知类型：非 JSON 报错",
			message: model.Message{MsgType: "systemwarning", Content: "x"},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			message := tt.message
			spec, err := buildLarkAppMessage(&message)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("期望返回错误，实际得到 %+v", spec)
				}
				return
			}
			if err != nil {
				t.Fatalf("未预期的错误：%v", err)
			}
			if spec.MsgType != tt.wantMsgType {
				t.Fatalf("msg_type 不匹配：got %q, want %q", spec.MsgType, tt.wantMsgType)
			}
			got := larkTestJSON(t, spec.Content)
			want := larkTestJSON(t, tt.wantContent)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("content 不匹配：\n got: %s\nwant: %s", spec.Content, tt.wantContent)
			}
		})
	}
}
