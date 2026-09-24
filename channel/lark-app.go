package channel

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	"message-pusher/model"
)

// larkAppClients 缓存 SDK 客户端，以复用 SDK 内部的 tenant_access_token 缓存，
// 避免每条消息都重新获取一次 token。
var larkAppClients sync.Map // "appId|appSecret" -> *lark.Client

func getLarkAppClient(appId string, appSecret string) *lark.Client {
	key := fmt.Sprintf("%s|%s", appId, appSecret)
	if value, ok := larkAppClients.Load(key); ok {
		return value.(*lark.Client)
	}
	client := lark.NewClient(appId, appSecret)
	actual, _ := larkAppClients.LoadOrStore(key, client)
	return actual.(*lark.Client)
}

func parseLarkAppTarget(target string) (string, string, error) {
	parts := strings.Split(target, ":")
	if len(parts) != 2 {
		return "", "", errors.New("无效的飞书应用号消息接收者参数")
	}
	return parts[0], parts[1], nil
}

func SendLarkAppMessage(message *model.Message, user *model.User, channel_ *model.Channel) error {
	// https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create
	rawTarget := message.To
	if rawTarget == "" {
		rawTarget = channel_.AccountId
	}
	targetType, target, err := parseLarkAppTarget(rawTarget)
	if err != nil {
		return err
	}
	spec, err := buildLarkAppMessage(message)
	if err != nil {
		return err
	}
	request := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType(targetType).
		Body(larkim.NewCreateMessageReqBodyBuilder().
			ReceiveId(target).
			MsgType(spec.MsgType).
			Content(spec.Content).
			Build()).
		Build()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	response, err := getLarkAppClient(channel_.AppId, channel_.Secret).Im.V1.Message.Create(ctx, request)
	if err != nil {
		return err
	}
	if !response.Success() {
		return fmt.Errorf("飞书应用号发送消息失败：code=%d, msg=%s", response.Code, response.Msg)
	}
	return nil
}
