package channel

import (
	"encoding/json"
	"errors"
	"fmt"
	"message-pusher/model"
	"strings"
)

// 飞书自建应用（im/v1）支持的消息类型
// https://open.feishu.cn/document/server-docs/im-v1/message-content-description/create_json
const (
	larkMsgTypeText        = "text"
	larkMsgTypePost        = "post"
	larkMsgTypeImage       = "image"
	larkMsgTypeInteractive = "interactive"
	larkMsgTypeShareChat   = "share_chat"
	larkMsgTypeShareUser   = "share_user"
	larkMsgTypeAudio       = "audio"
	larkMsgTypeMedia       = "media"
	larkMsgTypeFile        = "file"
	larkMsgTypeSticker     = "sticker"
)

var larkAppSupportedMsgTypes = []string{
	larkMsgTypeText,
	larkMsgTypePost,
	larkMsgTypeImage,
	larkMsgTypeInteractive,
	larkMsgTypeShareChat,
	larkMsgTypeShareUser,
	larkMsgTypeAudio,
	larkMsgTypeMedia,
	larkMsgTypeFile,
	larkMsgTypeSticker,
}

// 卡片 1.0 结构
// https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/feishu-card-overview
type larkCardElementText struct {
	Tag     string `json:"tag"`
	Content string `json:"content"`
}

type larkCardElement struct {
	Tag  string               `json:"tag"`
	Text *larkCardElementText `json:"text,omitempty"`
}

type larkCardConfig struct {
	WideScreenMode bool `json:"wide_screen_mode"`
	EnableForward  bool `json:"enable_forward"`
}

type larkCard struct {
	Config   larkCardConfig    `json:"config"`
	Elements []larkCardElement `json:"elements"`
}

// larkAppMessageSpec 是归一化之后、可直接交给飞书 im/v1 发送接口的消息。
type larkAppMessageSpec struct {
	MsgType string
	Content string
}

// buildLarkAppMessage 根据 message 的字段构造自建应用可发送的消息。
// 当 message.MsgType 为空时保持历史行为：description 作为文本消息，content 作为交互卡片。
func buildLarkAppMessage(message *model.Message) (*larkAppMessageSpec, error) {
	msgType := strings.ToLower(strings.TrimSpace(message.MsgType))
	if msgType == "" {
		if message.Description != "" {
			msgType = larkMsgTypeText
		} else {
			msgType = larkMsgTypeInteractive
		}
	}
	switch msgType {
	case larkMsgTypeText:
		return buildLarkAppTextMessage(message)
	case larkMsgTypePost:
		return buildLarkAppPostMessage(message)
	case larkMsgTypeInteractive:
		return buildLarkAppInteractiveMessage(message)
	case larkMsgTypeImage:
		return buildLarkAppKeyedContentMessage(msgType, message.Content, "image_key")
	case larkMsgTypeShareChat:
		return buildLarkAppKeyedContentMessage(msgType, message.Content, "chat_id")
	case larkMsgTypeShareUser:
		return buildLarkAppKeyedContentMessage(msgType, message.Content, "user_id")
	case larkMsgTypeAudio, larkMsgTypeMedia, larkMsgTypeFile, larkMsgTypeSticker:
		return buildLarkAppKeyedContentMessage(msgType, message.Content, "file_key")
	default:
		// 未知类型：content 是合法的 JSON 对象则原样透传，以兼容飞书将来新增的消息类型
		if raw, ok := larkJSONObject(message.Content); ok {
			return &larkAppMessageSpec{MsgType: msgType, Content: string(raw)}, nil
		}
		return nil, fmt.Errorf("不支持的消息类型 %s，支持的类型有：%s；也可以直接传入合法的 JSON 对象作为 content 以便透传",
			message.MsgType, strings.Join(larkAppSupportedMsgTypes, "、"))
	}
}

func buildLarkAppTextMessage(message *model.Message) (*larkAppMessageSpec, error) {
	text := message.Description
	if text == "" {
		text = message.Content
	}
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("文本消息内容为空")
	}
	return larkNewAppMessageSpec(larkMsgTypeText, larkTextContent{Text: text})
}

func buildLarkAppPostMessage(message *model.Message) (*larkAppMessageSpec, error) {
	if strings.TrimSpace(message.Content) == "" {
		return nil, errors.New("富文本消息（post）的 content 不能为空")
	}
	obj, ok := larkJSONObjectMap(message.Content)
	if !ok {
		return nil, errors.New("富文本消息（post）的 content 必须为 JSON 对象")
	}
	// 兼容三种写法：{"post":{...}}、{"zh_cn":{...}}、{"title":"...","content":[[...]]}
	var postLang map[string]interface{}
	if value, exists := obj["post"]; exists {
		post, ok := value.(map[string]interface{})
		if !ok {
			return nil, errors.New("富文本消息（post）的 content.post 必须为 JSON 对象")
		}
		postLang = post
	} else if _, exists := obj["zh_cn"]; exists {
		postLang = obj
	} else if _, exists := obj["en_us"]; exists {
		postLang = obj
	} else {
		postLang = map[string]interface{}{"zh_cn": obj}
	}
	if err := validateLarkPostLang(postLang); err != nil {
		return nil, err
	}
	return larkNewAppMessageSpec(larkMsgTypePost, postLang)
}

func validateLarkPostLang(postLang map[string]interface{}) error {
	hasLang := false
	for _, lang := range []string{"zh_cn", "en_us"} {
		value, exists := postLang[lang]
		if !exists {
			continue
		}
		hasLang = true
		block, ok := value.(map[string]interface{})
		if !ok {
			return fmt.Errorf("富文本消息（post）的 %s 必须为 JSON 对象", lang)
		}
		content, exists := block["content"]
		if !exists {
			return fmt.Errorf("富文本消息（post）的 %s.content 不能为空", lang)
		}
		if _, ok := content.([]interface{}); !ok {
			return fmt.Errorf("富文本消息（post）的 %s.content 必须为段落数组", lang)
		}
	}
	if !hasLang {
		return errors.New("富文本消息（post）的 content 至少需要包含 zh_cn 或 en_us 中的一种语言配置")
	}
	return nil
}

func buildLarkAppInteractiveMessage(message *model.Message) (*larkAppMessageSpec, error) {
	if strings.TrimSpace(message.Content) == "" {
		return nil, errors.New("交互卡片消息（interactive）的 content 不能为空")
	}
	// content 是合法的 JSON 对象时，直接作为卡片内容（支持卡片 1.0 和 2.0）
	if raw, ok := larkJSONObject(message.Content); ok {
		return &larkAppMessageSpec{MsgType: larkMsgTypeInteractive, Content: string(raw)}, nil
	}
	card := larkCard{
		Config: larkCardConfig{
			WideScreenMode: true,
			EnableForward:  true,
		},
		Elements: []larkCardElement{
			{
				Tag: "div",
				Text: &larkCardElementText{
					Tag:     "lark_md",
					Content: message.Content,
				},
			},
		},
	}
	return larkNewAppMessageSpec(larkMsgTypeInteractive, card)
}

// buildLarkAppKeyedContentMessage 处理 image、share_chat、share_user、audio、media、file、sticker
// 这类只有单个必填字段的消息类型。
func buildLarkAppKeyedContentMessage(msgType string, content string, key string) (*larkAppMessageSpec, error) {
	if strings.TrimSpace(content) == "" {
		return nil, fmt.Errorf("%s 消息的 content 不能为空", msgType)
	}
	if raw, ok := larkJSONObject(content); ok {
		return &larkAppMessageSpec{MsgType: msgType, Content: string(raw)}, nil
	}
	return larkNewAppMessageSpec(msgType, map[string]string{key: strings.TrimSpace(content)})
}

func larkNewAppMessageSpec(msgType string, content interface{}) (*larkAppMessageSpec, error) {
	data, err := json.Marshal(content)
	if err != nil {
		return nil, fmt.Errorf("序列化 %s 消息的 content 失败：%s", msgType, err.Error())
	}
	return &larkAppMessageSpec{MsgType: msgType, Content: string(data)}, nil
}

// larkJSONObject 判断 s 是否为合法的 JSON 对象，是则返回其原始内容。
func larkJSONObject(s string) (json.RawMessage, bool) {
	if _, ok := larkJSONObjectMap(s); !ok {
		return nil, false
	}
	return json.RawMessage(s), true
}

// larkJSONObjectMap 解析 JSON 对象，非对象（数组、标量、null、非法 JSON）一律返回 false。
func larkJSONObjectMap(s string) (map[string]interface{}, bool) {
	if strings.TrimSpace(s) == "" {
		return nil, false
	}
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(s), &obj); err != nil || obj == nil {
		return nil, false
	}
	return obj, true
}
