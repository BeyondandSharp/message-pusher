package model

import (
	"encoding/json"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMessageExtraVariablesRoundTrip(t *testing.T) {
	message := &Message{}
	err := message.SetExtraVariables(map[string]interface{}{
		"content_test": "mmmmmsg",
		"nested": map[string]interface{}{
			"title": "IP: IP更新",
			"count": json.Number("1234567890123456789"),
		},
	})
	if err != nil {
		t.Fatalf("序列化自定义变量失败：%v", err)
	}
	if message.Extra == "" {
		t.Fatal("自定义变量没有写入 Extra")
	}

	variables := message.ExtraVariables()
	if got := variables["content_test"]; got != "mmmmmsg" {
		t.Fatalf("content_test 不匹配：%v", got)
	}
	nested, ok := variables["nested"].(map[string]interface{})
	if !ok {
		t.Fatalf("nested 类型不匹配：%#v", variables["nested"])
	}
	if got := nested["title"]; got != "IP: IP更新" {
		t.Fatalf("nested.title 不匹配：%v", got)
	}
	if got := nested["count"]; got != json.Number("1234567890123456789") {
		t.Fatalf("大整数精度丢失：%#v", got)
	}

	if err := message.SetExtraVariables(nil); err != nil {
		t.Fatalf("清空自定义变量失败：%v", err)
	}
	if message.Extra != "" || message.ExtraVariables() != nil {
		t.Fatal("清空后 Extra 应为空")
	}
}

func TestMessageExtraVariablesInvalidJSON(t *testing.T) {
	message := &Message{Extra: "not-json"}
	if variables := message.ExtraVariables(); variables != nil {
		t.Fatalf("非法 JSON 应返回 nil，实际为 %#v", variables)
	}
}

func TestMessageExtraPersisted(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:message-extra-test?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开测试数据库失败：%v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("获取底层数据库失败：%v", err)
	}
	defer sqlDB.Close()
	if err := db.AutoMigrate(&Message{}); err != nil {
		t.Fatalf("迁移 Message 失败：%v", err)
	}

	message := &Message{UserId: 1, Title: "标题"}
	if err := message.SetExtraVariables(map[string]interface{}{"content_test": "mmmmmsg"}); err != nil {
		t.Fatalf("设置自定义变量失败：%v", err)
	}
	if err := db.Create(message).Error; err != nil {
		t.Fatalf("保存消息失败：%v", err)
	}

	var loaded Message
	if err := db.First(&loaded, message.Id).Error; err != nil {
		t.Fatalf("读取消息失败：%v", err)
	}
	if got := loaded.ExtraVariables()["content_test"]; got != "mmmmmsg" {
		t.Fatalf("Extra 未能持久化，实际为 %v", got)
	}
}
