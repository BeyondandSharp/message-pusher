package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"io"
	"message-pusher/common"
	"message-pusher/model"
	"net/http"
	"strconv"
	"strings"
)

func GetAllWebhooks(c *gin.Context) {
	userId := c.GetInt("id")
	p, _ := strconv.Atoi(c.Query("p"))
	if p < 0 {
		p = 0
	}
	webhooks, err := model.GetWebhooksByUserId(userId, p*common.ItemsPerPage, common.ItemsPerPage)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    webhooks,
	})
	return
}

func SearchWebhooks(c *gin.Context) {
	userId := c.GetInt("id")
	keyword := c.Query("keyword")
	if strings.HasPrefix(keyword, common.ServerAddress+"/webhook/") {
		keyword = strings.TrimPrefix(keyword, common.ServerAddress+"/webhook/")
	}
	webhooks, err := model.SearchWebhooks(userId, keyword)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    webhooks,
	})
	return
}

func GetWebhook(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	webhook_, err := model.GetWebhookById(id, userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    webhook_,
	})
	return
}

func AddWebhook(c *gin.Context) {
	webhook_ := model.Webhook{}
	err := c.ShouldBindJSON(&webhook_)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if len(webhook_.Name) == 0 || len(webhook_.Name) > 20 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "通道名称长度必须在1-20之间",
		})
		return
	}
	cleanWebhook := model.Webhook{
		UserId:           c.GetInt("id"),
		Name:             webhook_.Name,
		Status:           common.WebhookStatusEnabled,
		Link:             common.GetUUID(),
		CreatedTime:      common.GetTimestamp(),
		Channel:          webhook_.Channel,
		ExtractRule:      webhook_.ExtractRule,
		ConstructRule:    webhook_.ConstructRule,
		PreScriptEnabled: webhook_.PreScriptEnabled,
		PreScript:        webhook_.PreScript,
	}
	err = cleanWebhook.Insert()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func DeleteWebhook(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	_, err := model.DeleteWebhookById(id, userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func UpdateWebhook(c *gin.Context) {
	userId := c.GetInt("id")
	statusOnly := c.Query("status_only")
	webhook_ := model.Webhook{}
	err := c.ShouldBindJSON(&webhook_)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	oldWebhook, err := model.GetWebhookById(webhook_.Id, userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	cleanWebhook := *oldWebhook
	if statusOnly != "" {
		cleanWebhook.Status = webhook_.Status
	} else {
		// If you add more fields, please also update webhook_.Update()
		cleanWebhook.Name = webhook_.Name
		cleanWebhook.ExtractRule = webhook_.ExtractRule
		cleanWebhook.ConstructRule = webhook_.ConstructRule
		cleanWebhook.Channel = webhook_.Channel
		cleanWebhook.PreScriptEnabled = webhook_.PreScriptEnabled
		cleanWebhook.PreScript = webhook_.PreScript
	}
	err = cleanWebhook.Update()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    cleanWebhook,
	})
	return
}

func TriggerWebhook(c *gin.Context) {
	jsonData, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	reqText := string(jsonData)
	link := c.Param("link")
	webhook, err := model.GetWebhookByLink(link)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "Webhook 不存在",
		})
		return
	}
	if webhook.Status != common.WebhookStatusEnabled {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "Webhook 未启用",
		})
		return
	}
	user, err := model.GetUserById(webhook.UserId, false)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "用户不存在",
		})
		return
	}
	if user.Status != common.UserStatusEnabled {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "用户已被封禁",
		})
		return
	}
	// 前置脚本：先用 JS 处理请求数据，再把处理结果交给提取规则和构建规则。
	// 处理结果会重新序列化成 JSON 文本，因此后面的 gjson 提取、变量替换都不用改动。
	if webhook.PreScriptEnabled {
		var input interface{}
		if err := json.Unmarshal(jsonData, &input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": "启用前置脚本时，请求体必须是合法的 JSON：" + err.Error(),
			})
			return
		}
		output, err := model.RunPreScript(webhook.PreScript, input)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "Webhook 前置脚本执行失败：" + err.Error(),
			})
			return
		}
		processed, err := json.Marshal(output)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "Webhook 前置脚本的返回值无法序列化为 JSON：" + err.Error(),
			})
			return
		}
		reqText = string(processed)
	}
	extractRule := make(map[string]string)
	err = json.Unmarshal([]byte(webhook.ExtractRule), &extractRule)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Webhook 提取规则解析失败：" + err.Error(),
		})
		return
	}
	variables := make(map[string]string, len(extractRule))
	for key, value := range extractRule {
		variables[key] = gjson.Get(reqText, value).String()
	}
	constructRule, err := model.RenderWebhookConstructRule(webhook.ConstructRule, variables)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "Webhook 构建规则解析失败：" + err.Error(),
		})
		return
	}
	message := &model.Message{
		Channel:     webhook.Channel,
		Title:       model.WebhookConstructRuleString(constructRule.Title),
		Description: model.WebhookConstructRuleString(constructRule.Description),
		Content:     model.WebhookConstructRuleString(constructRule.Content),
		URL:         model.WebhookConstructRuleString(constructRule.URL),
	}
	processMessage(c, message, user, false)
}
