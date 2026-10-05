package common

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net/smtp"
	"strings"
	"time"
)

// encodeMailHeader 按 RFC 2047 编码邮件头里的非 ASCII 文本。
// 直接写入中文系统名会让部分邮件服务判定 From 头非法而退信，
// 客户端也可能显示乱码（见上游 issue #127 / #169）。
func encodeMailHeader(text string) string {
	return fmt.Sprintf("=?UTF-8?B?%s?=", base64.StdEncoding.EncodeToString([]byte(text)))
}

// mailDomain 取发件账号的域名部分，用于构造 Message-ID。
func mailDomain(account string) string {
	if idx := strings.LastIndex(account, "@"); idx >= 0 && idx+1 < len(account) {
		return account[idx+1:]
	}
	return "localhost"
}

// buildEmailMessage 组装邮件内容。
// 除了正文，还补上 Date 与每次唯一的 Message-ID：部分邮件服务会把
// 没有 Message-ID 的重复邮件当垃圾邮件过滤（见上游 issue #120）。
func buildEmailMessage(subject string, receiver string, content string) []byte {
	from := fmt.Sprintf("<%s>", SMTPAccount)
	if SystemName != "" {
		from = fmt.Sprintf("%s <%s>", encodeMailHeader(SystemName), SMTPAccount)
	}
	return []byte(fmt.Sprintf("To: %s\r\n"+
		"From: %s\r\n"+
		"Subject: %s\r\n"+
		"Date: %s\r\n"+
		"Message-ID: <%s@%s>\r\n"+
		"Content-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n",
		receiver, from, encodeMailHeader(subject),
		time.Now().Format(time.RFC1123Z), GetUUID(), mailDomain(SMTPAccount), content))
}

func SendEmail(subject string, receiver string, content string) error {
	mail := buildEmailMessage(subject, receiver, content)
	auth := smtp.PlainAuth("", SMTPAccount, SMTPToken, SMTPServer)
	addr := fmt.Sprintf("%s:%d", SMTPServer, SMTPPort)
	to := strings.Split(receiver, ";")
	var err error
	if SMTPPort == 465 {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: true,
			ServerName:         SMTPServer,
		}
		conn, err := tls.Dial("tcp", fmt.Sprintf("%s:%d", SMTPServer, SMTPPort), tlsConfig)
		if err != nil {
			return err
		}
		client, err := smtp.NewClient(conn, SMTPServer)
		if err != nil {
			return err
		}
		defer client.Close()
		if err = client.Auth(auth); err != nil {
			return err
		}
		if err = client.Mail(SMTPAccount); err != nil {
			return err
		}
		receiverEmails := strings.Split(receiver, ";")
		for _, receiver := range receiverEmails {
			if err = client.Rcpt(receiver); err != nil {
				return err
			}
		}
		w, err := client.Data()
		if err != nil {
			return err
		}
		_, err = w.Write(mail)
		if err != nil {
			return err
		}
		err = w.Close()
		if err != nil {
			return err
		}
	} else {
		err = smtp.SendMail(addr, auth, SMTPAccount, to, mail)
	}
	return err
}
