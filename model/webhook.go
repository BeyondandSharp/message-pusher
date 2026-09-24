package model

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
)

// WebhookConstructRule 是 Webhook 的构建规则，即一个与 Message 字段一一对应的消息模板。
//
// 字段的值既可以是字符串，也可以是任意 JSON 结构（对象、数组等）：
// 字符串会直接作为消息字段，其余结构会被序列化成 JSON 文本作为消息字段，
// 因此可以用它构造飞书卡片一类的结构化消息内容。
type WebhookConstructRule struct {
	Title       interface{} `json:"title"`
	Description interface{} `json:"description"`
	Content     interface{} `json:"content"`
	URL         interface{} `json:"url"`
}

// WebhookConstructRuleString 把构建规则中的字段值转换为消息字段所需的字符串。
func WebhookConstructRuleString(value interface{}) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	default:
		data, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(data)
	}
}

// RenderWebhookConstructRule 用提取出来的模板变量渲染构建规则。
//
// 变量替换发生在解析后的 JSON 结构上，而不是对 JSON 文本做字符串替换，
// 因此变量值里含有引号、换行等特殊字符时不会破坏 JSON，
// 并且嵌套在对象、数组中的变量同样会被替换。
func RenderWebhookConstructRule(constructRule string, variables map[string]string) (*WebhookConstructRule, error) {
	rule := &WebhookConstructRule{}
	decoder := json.NewDecoder(strings.NewReader(constructRule))
	// 用 json.Number 保留数字原本的写法，避免大整数被转成浮点数
	decoder.UseNumber()
	if err := decoder.Decode(rule); err != nil {
		return nil, err
	}
	pairs := sortedWebhookVariables(variables)
	rule.Title = replaceWebhookVariables(rule.Title, pairs)
	rule.Description = replaceWebhookVariables(rule.Description, pairs)
	rule.Content = replaceWebhookVariables(rule.Content, pairs)
	rule.URL = replaceWebhookVariables(rule.URL, pairs)
	return rule, nil
}

// sortedWebhookVariables 按变量名从长到短排序，避免 $title 误伤 $title_extra。
func sortedWebhookVariables(variables map[string]string) [][2]string {
	keys := make([]string, 0, len(variables))
	for key := range variables {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if len(keys[i]) != len(keys[j]) {
			return len(keys[i]) > len(keys[j])
		}
		return keys[i] < keys[j]
	})
	pairs := make([][2]string, 0, len(keys))
	for _, key := range keys {
		pairs = append(pairs, [2]string{"$" + key, variables[key]})
	}
	return pairs
}

// replaceWebhookVariables 递归地把字符串中的模板变量替换为其取值。
func replaceWebhookVariables(value interface{}, pairs [][2]string) interface{} {
	switch v := value.(type) {
	case string:
		for _, pair := range pairs {
			v = strings.ReplaceAll(v, pair[0], pair[1])
		}
		return v
	case map[string]interface{}:
		for key, item := range v {
			v[key] = replaceWebhookVariables(item, pairs)
		}
		return v
	case []interface{}:
		for i, item := range v {
			v[i] = replaceWebhookVariables(item, pairs)
		}
		return v
	default:
		return value
	}
}

type Webhook struct {
	Id            int    `json:"id"`
	UserId        int    `json:"user_id" gorm:"index"`
	Name          string `json:"name" gorm:"type:varchar(32);index"`
	Status        int    `json:"status" gorm:"default:1"` // enabled, disabled
	Link          string `json:"link" gorm:"type:char(32);uniqueIndex"`
	CreatedTime   int64  `json:"created_time" gorm:"bigint"`
	ExtractRule   string `json:"extract_rule" gorm:"not null"`              // how we extract key info from the request
	ConstructRule string `json:"construct_rule" gorm:"not null"`            // how we construct message with the extracted info
	Channel       string `json:"channel" gorm:"type:varchar(32); not null"` // which channel to send our message
}

func GetWebhookById(id int, userId int) (*Webhook, error) {
	if id == 0 || userId == 0 {
		return nil, errors.New("id 或 userId 为空！")
	}
	c := Webhook{Id: id, UserId: userId}
	err := DB.Where(c).First(&c).Error
	return &c, err
}

func GetWebhookByLink(link string) (*Webhook, error) {
	if link == "" {
		return nil, errors.New("link 为空！")
	}
	c := Webhook{Link: link}
	err := DB.Where(c).First(&c).Error
	return &c, err
}

func GetWebhooksByUserId(userId int, startIdx int, num int) (webhooks []*Webhook, err error) {
	err = DB.Where("user_id = ?", userId).Order("id desc").Limit(num).Offset(startIdx).Find(&webhooks).Error
	return webhooks, err
}

func SearchWebhooks(userId int, keyword string) (webhooks []*Webhook, err error) {
	err = DB.Where("user_id = ?", userId).Where("id = ? or link = ? or name LIKE ?", keyword, keyword, keyword+"%").Find(&webhooks).Error
	return webhooks, err
}

func DeleteWebhookById(id int, userId int) (c *Webhook, err error) {
	// Why we need userId here? In case user want to delete other's c.
	if id == 0 || userId == 0 {
		return nil, errors.New("id 或 userId 为空！")
	}
	c = &Webhook{Id: id, UserId: userId}
	err = DB.Where(c).First(&c).Error
	if err != nil {
		return nil, err
	}
	return c, c.Delete()
}

func (webhook *Webhook) Insert() error {
	var err error
	err = DB.Create(webhook).Error
	return err
}

func (webhook *Webhook) UpdateStatus(status int) error {
	err := DB.Model(webhook).Update("status", status).Error
	return err
}

// Update Make sure your token's fields is completed, because this will update zero values
func (webhook *Webhook) Update() error {
	var err error
	err = DB.Model(webhook).Select("status", "name", "extract_rule", "construct_rule", "channel").Updates(webhook).Error
	return err
}

func (webhook *Webhook) Delete() error {
	err := DB.Delete(webhook).Error
	return err
}
