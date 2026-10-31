package common

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// escapeTemplateValue 把替换值转义成可以直接放进 JSON 字符串的形式。
// 与原来的 Replace 行为保持一致：引号、换行等字符会被转义，避免破坏请求体 JSON。
func escapeTemplateValue(value string) string {
	return strings.TrimPrefix(strings.TrimSuffix(fmt.Sprintf("%q", value), "\""), "\"")
}

// RenderTemplate 渲染自定义通道的请求体模板。
//
// 支持：
//   - 顶层变量：$title、$content、$content_test 等；
//   - 嵌套路径：$content.data.template_variable.title，数组下标写成 $content.items.0.title；
//   - 变量值是 JSON 字符串时，会先解析成 JSON 再按路径取值。
//
// 变量名按长度从长到短匹配，避免 $title 误伤 $title_extra。
// 未定义变量或无法解析的路径会原样保留，便于发现拼写错误。
// 替换值按 JSON 字符串转义，因此模板里的变量应放在 JSON 引号内使用。
func RenderTemplate(template string, variables map[string]interface{}) string {
	names := make([]string, 0, len(variables))
	for name := range variables {
		if name != "" {
			names = append(names, name)
		}
	}
	sort.Slice(names, func(i, j int) bool {
		if len(names[i]) != len(names[j]) {
			return len(names[i]) > len(names[j])
		}
		return names[i] < names[j]
	})

	var builder strings.Builder
	builder.Grow(len(template))
	for i := 0; i < len(template); {
		if template[i] != '$' {
			builder.WriteByte(template[i])
			i++
			continue
		}
		name := ""
		for _, candidate := range names {
			if strings.HasPrefix(template[i+1:], candidate) {
				name = candidate
				break
			}
		}
		if name == "" {
			builder.WriteByte(template[i])
			i++
			continue
		}
		value := variables[name]
		variableEnd := i + 1 + len(name)
		if variableEnd+1 < len(template) && template[variableEnd] == '.' && isTemplatePathStartByte(template[variableEnd+1]) {
			pathEnd := variableEnd + 1
			for pathEnd < len(template) && isTemplatePathByte(template[pathEnd]) {
				pathEnd++
			}
			path := template[variableEnd+1 : pathEnd]
			if path != "" && !strings.HasPrefix(path, ".") && !strings.HasSuffix(path, ".") {
				if resolved, ok := resolveTemplatePath(value, strings.Split(path, ".")); ok {
					if text, ok := templateValueString(resolved); ok {
						builder.WriteString(escapeTemplateValue(text))
						i = pathEnd
						continue
					}
				}
			}
			if isTemplatePathCapable(value) {
				// 值本身是 JSON 对象/数组时，点号大概率是路径；解析失败时保留
				// 整个占位符，方便用户发现路径写错。
				builder.WriteString(template[i:pathEnd])
				i = pathEnd
			} else {
				// 普通字符串后紧跟句号等文本（例如 $title.html）时，保持旧行为：
				// 只替换变量本身，点号及后面的内容原样保留。
				if text, ok := templateValueString(value); ok {
					builder.WriteString(escapeTemplateValue(text))
				} else {
					builder.WriteString(template[i:variableEnd])
				}
				i = variableEnd
			}
			continue
		}
		if text, ok := templateValueString(value); ok {
			if variableEnd < len(template) && isTemplateIdentifierByte(template[variableEnd]) {
				// 后面还跟着标识符字符，说明模板里写的是更长的变量名（只是没定义），
				// 此时不能把 $content 从 $content_test 里截断替换掉。
				builder.WriteString(template[i:variableEnd])
			} else {
				builder.WriteString(escapeTemplateValue(text))
			}
		} else {
			builder.WriteString(template[i:variableEnd])
		}
		i = variableEnd
	}
	return builder.String()
}

// isTemplateIdentifierByte 判断变量名可能还没结束的字符（字母/数字/下划线）。
func isTemplateIdentifierByte(b byte) bool {
	return b >= 'a' && b <= 'z' ||
		b >= 'A' && b <= 'Z' ||
		b >= '0' && b <= '9' ||
		b == '_'
}

// isTemplatePathByte 允许 JSON 路径里常见的字符；数组下标是纯数字。
func isTemplatePathByte(b byte) bool {
	return b >= 'a' && b <= 'z' ||
		b >= 'A' && b <= 'Z' ||
		b >= '0' && b <= '9' ||
		b == '_' || b == '-' || b == '.'
}

// isTemplatePathStartByte 只有点号后面跟着合法的路径片段时才按路径解析，
// 这样 "$title." 这类“变量名 + 句号”的普通文本不会被误判成路径。
func isTemplatePathStartByte(b byte) bool {
	return b >= 'a' && b <= 'z' ||
		b >= 'A' && b <= 'Z' ||
		b >= '0' && b <= '9' ||
		b == '_' || b == '-'
}

// isTemplatePathCapable 只有值本身可能是 JSON 对象/数组时，才把变量后的点号
// 当作路径分隔符；普通字符串后的点号按普通文本处理，兼容旧模板。
func isTemplatePathCapable(value interface{}) bool {
	switch v := value.(type) {
	case map[string]interface{}, []interface{}:
		return true
	case string:
		trimmed := strings.TrimSpace(v)
		return strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[")
	default:
		return false
	}
}

// resolveTemplatePath 沿着 map/数组向下取值；中间遇到 JSON 字符串会先解析。
func resolveTemplatePath(value interface{}, path []string) (interface{}, bool) {
	current := value
	for _, segment := range path {
		if segment == "" {
			return nil, false
		}
		if text, ok := current.(string); ok {
			parsed, ok := parseTemplateJSON(text)
			if !ok {
				return nil, false
			}
			current = parsed
		}
		switch node := current.(type) {
		case map[string]interface{}:
			next, ok := node[segment]
			if !ok {
				return nil, false
			}
			current = next
		case []interface{}:
			index, err := strconv.Atoi(segment)
			if err != nil || index < 0 || index >= len(node) {
				return nil, false
			}
			current = node[index]
		default:
			return nil, false
		}
	}
	return current, true
}

func parseTemplateJSON(text string) (interface{}, bool) {
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.UseNumber()
	var value interface{}
	if err := decoder.Decode(&value); err != nil {
		return nil, false
	}
	return value, true
}

// templateValueString 把任意类型的变量值转成模板里要插入的文本。
func templateValueString(value interface{}) (string, bool) {
	switch v := value.(type) {
	case nil:
		return "", true
	case string:
		return v, true
	case json.Number:
		return v.String(), true
	case bool:
		return strconv.FormatBool(v), true
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), true
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 32), true
	case int:
		return strconv.Itoa(v), true
	case int64:
		return strconv.FormatInt(v, 10), true
	case int32:
		return strconv.FormatInt(int64(v), 10), true
	case uint:
		return strconv.FormatUint(uint64(v), 10), true
	case uint64:
		return strconv.FormatUint(v, 10), true
	default:
		data, err := json.Marshal(v)
		if err != nil {
			return "", false
		}
		return string(data), true
	}
}
