package channel

import (
	"encoding/json"
	"testing"

	"message-pusher/model"
)

func TestRenderCustomMessageBody(t *testing.T) {
	message := &model.Message{
		Id:          7,
		Title:       "IP更新",
		Description: "描述",
		Content:     `{"type":"template","data":{"template_id":"AAqT4DxII5iEU","template_variable":{"title":"IP: IP更新","content":""}}}`,
		URL:         "https://example.com/message/abc",
		To:          "someone",
		Link:        "abc",
		Channel:     "custom",
		Timestamp:   1700000000,
		RenderMode:  "markdown",
		MsgType:     "text",
		Extra:       `{"content_test":"mmmmmsg","nested":{"value":"n"}}`,
	}
	template := `{
		"id": "$id",
		"title": "$title",
		"content_test": "$content_test",
		"nested": "$content.data.template_variable.title",
		"template_id": "$content.data.template_id",
		"empty": "$content.data.template_variable.content",
		"custom_nested": "$nested.value",
		"link": "$link",
		"channel": "$channel",
		"timestamp": "$timestamp",
		"render_mode": "$render_mode",
		"msg_type": "$msg_type"
	}`
	body := renderCustomMessageBody(template, message)
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		t.Fatalf("渲染后的请求体不是合法 JSON：%v\n%s", err, body)
	}
	want := map[string]string{
		"id":            "7",
		"title":         "IP更新",
		"content_test":  "mmmmmsg",
		"nested":        "IP: IP更新",
		"template_id":   "AAqT4DxII5iEU",
		"empty":         "",
		"custom_nested": "n",
		"link":          "abc",
		"channel":       "custom",
		"timestamp":     "1700000000",
		"render_mode":   "markdown",
		"msg_type":      "text",
	}
	for key, expected := range want {
		if got := parsed[key]; got != expected {
			t.Fatalf("%s 不匹配：got %v, want %q\n%s", key, got, expected, body)
		}
	}
}

func TestRenderCustomMessageBodyKeepsUnknownVariables(t *testing.T) {
	message := &model.Message{Title: "标题"}
	body := renderCustomMessageBody(`{"unknown":"$unknown","title":"$title"}`, message)
	if body != `{"unknown":"$unknown","title":"标题"}` {
		t.Fatalf("未定义变量应原样保留，实际为 %s", body)
	}
}
