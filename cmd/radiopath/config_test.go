package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestDatasets checks where loadConfig looks for terrain and canopy tiles.
func TestDatasets(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "canopy1"), 0o755); err != nil {
		t.Fatal(err)
	}
	base := func(t *testing.T) {
		t.Setenv("DATABASE_URL", "postgres://x")
		t.Setenv("RADIOPATH_REGISTRATION", "false")
		// unset, not empty: an empty RADIOPATH_DATASET_CANOPY means no canopy
		for _, k := range []string{"RADIOPATH_DATASET_DIR", "RADIOPATH_DATASET_S3_ENDPOINT", "RADIOPATH_DATASET_S3_BUCKET",
			"RADIOPATH_DATASET_DEM", "RADIOPATH_DATASET_CANOPY"} {
			t.Setenv(k, "")
			os.Unsetenv(k)
		}
	}

	t.Run("defaults", func(t *testing.T) {
		base(t)
		t.Setenv("RADIOPATH_DATASET_DIR", root)
		c, err := loadConfig()
		if err != nil {
			t.Fatal(err)
		}
		if c.demDir != filepath.Join(root, "srtm1") || c.canopyDir != filepath.Join(root, "canopy1") {
			t.Errorf("dem %q, canopy %q", c.demDir, c.canopyDir)
		}
	})

	t.Run("canopy off", func(t *testing.T) {
		base(t)
		t.Setenv("RADIOPATH_DATASET_DIR", root)
		t.Setenv("RADIOPATH_DATASET_CANOPY", "")
		if c, err := loadConfig(); err != nil || c.canopyDir != "" {
			t.Errorf("canopy %q, %v", c.canopyDir, err)
		}
		t.Setenv("RADIOPATH_DATASET_CANOPY", "canopy2") // missing folder
		if c, err := loadConfig(); err != nil || c.canopyDir != "" {
			t.Errorf("canopy %q, %v", c.canopyDir, err)
		}
	})

	t.Run("s3", func(t *testing.T) {
		base(t)
		t.Setenv("RADIOPATH_DATASET_S3_ENDPOINT", "https://s3.example.org")
		t.Setenv("RADIOPATH_DATASET_S3_BUCKET", "datasets")
		t.Setenv("RADIOPATH_DATASET_DEM", "glo30")
		c, err := loadConfig()
		if err != nil {
			t.Fatal(err)
		}
		if c.s3Prefix != "glo30/" || c.canopyPrefix != "canopy1/" || c.demDir != "" {
			t.Errorf("dem %q, canopy %q, dir %q", c.s3Prefix, c.canopyPrefix, c.demDir)
		}
	})

	for name, env := range map[string]map[string]string{
		"no root":     {},
		"old name":    {"RADIOPATH_DATASET_DIR": root, "RADIOPATH_DEM_DIR": root},
		"no endpoint": {"RADIOPATH_DATASET_S3_BUCKET": "datasets"},
	} {
		t.Run(name, func(t *testing.T) {
			base(t)
			for k, v := range env {
				t.Setenv(k, v)
			}
			if _, err := loadConfig(); err == nil || !strings.Contains(err.Error(), "RADIOPATH_") {
				t.Errorf("want an error, got %v", err)
			}
		})
	}
}
