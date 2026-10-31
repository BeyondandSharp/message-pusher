package channel

import (
	"bytes"
	"errors"
	"net/http"
	"os"
	"strings"

	"message-pusher/common"
	"message-pusher/model"
)

// customTemplateVariables 汇总自定义通道请求体里可用的模板变量。
// 除消息自身字段外，Webhook 构建规则里的自定义键（如 content_test）也会加入，
// 例如 $content_test；同名字段以消息字段为准。
func customTemplateVariables(message *model.Message) map[string]interface{} {
	variables := map[string]interface{}{
		"id":          message.Id,
		"title":       message.Title,
		"description": message.Description,
		"content":     message.Content,
		"url":         message.URL,
		"to":          message.To,
		"link":        message.Link,
		"channel":     message.Channel,
		"timestamp":   message.Timestamp,
		"render_mode": message.RenderMode,
		"msg_type":    message.MsgType,
	}
	for key, value := range message.ExtraVariables() {
		if _, exists := variables[key]; !exists {
			variables[key] = value
		}
	}
	return variables
}

func renderCustomMessageBody(template string, message *model.Message) string {
	return common.RenderTemplate(template, customTemplateVariables(message))
}

func SendCustomMessage(message *model.Message, user *model.User, channel_ *model.Channel) error {
	url := channel_.URL
	if strings.HasPrefix(url, "http:") && os.Getenv("CHANNEL_URL_ALLOW_NON_HTTPS") != "true" {
		return errors.New("自定义通道必须使用 HTTPS 协议")
	}
	if strings.HasPrefix(url, common.ServerAddress) {
		return errors.New("自定义通道不能使用本服务地址")
	}
	reqBody := []byte(renderCustomMessageBody(channel_.Other, message))
	resp, err := http.Post(url, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return err
	}
	if resp.StatusCode != 200 {
		return errors.New(resp.Status)
	}
	return nil
}
