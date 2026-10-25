package store

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"
)

// Owner scoping, expiry, quota and the use stamp of API tokens: DATABASE_URL=... go test ./internal/store/
func TestTokens(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("no DATABASE_URL")
	}
	ctx := context.Background()
	st, err := New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(ctx, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}

	user := func(name string) int64 {
		var id int64
		if err := st.pool.QueryRow(ctx, `INSERT INTO users (name, password_hash) VALUES ($1, 'x')
			ON CONFLICT (name) DO UPDATE SET password_hash = 'x' RETURNING id`, name).Scan(&id); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { st.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id) })
		st.pool.Exec(ctx, `DELETE FROM api_tokens WHERE user_id = $1`, id)
		return id
	}
	owner, other := user("tokenowner"), user("tokenother")

	tok, err := st.CreateToken(ctx, owner, "Script", "rp_abcdefgh", "tokenhash-live", []string{"sites:read"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	u, id, scopes, err := st.TokenUser(ctx, "tokenhash-live")
	if err != nil || u.ID != owner || id != tok.ID || len(scopes) != 1 || scopes[0] != "sites:read" {
		t.Fatalf("TokenUser = %v %d %v %v", u.ID, id, scopes, err)
	}
	list, err := st.ListTokens(ctx, owner)
	if err != nil || len(list) != 1 || list[0].LastUsedAt == nil {
		t.Fatalf("ListTokens after use = %+v %v, want one token with last use", list, err)
	}

	past := time.Now().Add(-time.Hour)
	if _, err := st.CreateToken(ctx, owner, "Old", "rp_oldoldol", "tokenhash-expired", []string{"sites:read"}, &past); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := st.TokenUser(ctx, "tokenhash-expired"); err != ErrNotFound {
		t.Errorf("expired token: err = %v, want ErrNotFound", err)
	}

	if err := st.DeleteToken(ctx, other, tok.ID); err != ErrNotFound {
		t.Errorf("delete by another user: err = %v, want ErrNotFound", err)
	}
	if list, _ := st.ListTokens(ctx, other); len(list) != 0 {
		t.Errorf("another user lists %d tokens", len(list))
	}
	if err := st.DeleteToken(ctx, owner, tok.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := st.TokenUser(ctx, "tokenhash-live"); err != ErrNotFound {
		t.Errorf("revoked token: err = %v, want ErrNotFound", err)
	}

	for i := range MaxTokensPerUser {
		if _, err := st.CreateToken(ctx, other, "n", "rp_", "tokenhash-quota-"+string(rune('a'+i)), []string{"sites:read"}, nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.CreateToken(ctx, other, "n", "rp_", "tokenhash-quota-over", []string{"sites:read"}, nil); err != ErrQuota {
		t.Errorf("over quota: err = %v, want ErrQuota", err)
	}
}
