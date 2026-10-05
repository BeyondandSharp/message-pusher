package controller

import "testing"

func strPtr(s string) *string {
	return &s
}

func TestAuthMessage(t *testing.T) {
	tests := []struct {
		name         string
		messageToken string
		userToken    string
		channelToken *string
		want         bool
	}{
		{
			name: "用户与通道都没有令牌时免鉴权",
			want: true,
		},
		{
			name:         "只设置用户令牌时，不带令牌应被拒绝",
			userToken:    "user-token",
			messageToken: "",
			want:         false,
		},
		{
			name:         "只设置用户令牌时，错误令牌应被拒绝",
			userToken:    "user-token",
			messageToken: "wrong",
			want:         false,
		},
		{
			name:         "用户令牌命中",
			userToken:    "user-token",
			messageToken: "user-token",
			want:         true,
		},
		{
			name:         "通道令牌命中",
			userToken:    "user-token",
			channelToken: strPtr("channel-token"),
			messageToken: "channel-token",
			want:         true,
		},
		{
			name:         "用户令牌与通道令牌都不匹配",
			userToken:    "user-token",
			channelToken: strPtr("channel-token"),
			messageToken: "wrong",
			want:         false,
		},
		{
			name:         "只设置通道令牌时，不带令牌应被拒绝",
			channelToken: strPtr("channel-token"),
			messageToken: "",
			want:         false,
		},
		{
			name:         "只设置通道令牌时，通道令牌命中",
			channelToken: strPtr("channel-token"),
			messageToken: "channel-token",
			want:         true,
		},
		{
			name:         "通道令牌为空字符串时等同未设置",
			channelToken: strPtr(""),
			want:         true,
		},
		{
			name:         "通道令牌为 nil 且用户令牌为空时免鉴权",
			channelToken: nil,
			want:         true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := authMessage(tt.messageToken, tt.userToken, tt.channelToken); got != tt.want {
				t.Fatalf("authMessage(%q, %q, %v) = %v, want %v",
					tt.messageToken, tt.userToken, tt.channelToken, got, tt.want)
			}
		})
	}
}
