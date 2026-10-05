package common

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func mailHeaderValue(msg string, name string) string {
	for _, line := range strings.Split(msg, "\r\n") {
		if strings.HasPrefix(line, name+": ") {
			return strings.TrimPrefix(line, name+": ")
		}
	}
	return ""
}

func decodeEncodedWord(word string) string {
	const prefix = "=?UTF-8?B?"
	if !strings.HasPrefix(word, prefix) || !strings.HasSuffix(word, "?=") {
		return ""
	}
	raw := strings.TrimSuffix(strings.TrimPrefix(word, prefix), "?=")
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return ""
	}
	return string(data)
}

func TestBuildEmailMessage(t *testing.T) {
	oldName, oldAccount := SystemName, SMTPAccount
	defer func() {
		SystemName, SMTPAccount = oldName, oldAccount
	}()
	SystemName = "消息推送服务"
	SMTPAccount = "noreply@example.com"

	msg := string(buildEmailMessage("测试主题", "user@example.com", "<p>正文</p>"))
	if !strings.Contains(msg, "Content-Type: text/html; charset=UTF-8") {
		t.Fatalf("正文类型不应改变：\n%s", msg)
	}

	from := mailHeaderValue(msg, "From")
	if strings.Contains(msg, "From: 消息推送服务") {
		t.Fatalf("From 里不应出现未编码的中文系统名：%q", from)
	}
	nameEnd := strings.Index(from, " <")
	if nameEnd < 0 {
		t.Fatalf("From 格式不正确：%q", from)
	}
	if got := decodeEncodedWord(from[:nameEnd]); got != "消息推送服务" {
		t.Fatalf("From 展示名应可解码回系统名，实际为 %q", got)
	}
	if !strings.Contains(from, "<noreply@example.com>") {
		t.Fatalf("From 应包含发件地址，实际为 %q", from)
	}

	if got := decodeEncodedWord(mailHeaderValue(msg, "Subject")); got != "测试主题" {
		t.Fatalf("Subject 应可解码回原标题，实际为 %q", got)
	}

	if _, err := time.Parse(time.RFC1123Z, mailHeaderValue(msg, "Date")); err != nil {
		t.Fatalf("Date 头格式不正确：%v（%q）", err, mailHeaderValue(msg, "Date"))
	}

	messageID := mailHeaderValue(msg, "Message-ID")
	if !strings.HasPrefix(messageID, "<") || !strings.HasSuffix(messageID, "@example.com>") {
		t.Fatalf("Message-ID 格式不正确：%q", messageID)
	}
	second := mailHeaderValue(string(buildEmailMessage("测试主题", "user@example.com", "<p>正文</p>")), "Message-ID")
	if second == messageID {
		t.Fatalf("两次发送的 Message-ID 不应相同：%q", messageID)
	}

	SystemName = ""
	if got := mailHeaderValue(string(buildEmailMessage("s", "r", "c")), "From"); got != "<noreply@example.com>" {
		t.Fatalf("系统名为空时应退化为纯地址，实际为 %q", got)
	}
	if got := mailDomain("root"); got != "localhost" {
		t.Fatalf("账号没有域名时应回退 localhost，实际为 %q", got)
	}
}
