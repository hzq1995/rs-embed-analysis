from __future__ import annotations

import io
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import app
from backend.app.services.spartina_scene_service import (
    SPARTINA_MASK_ALPHA,
    get_spartina_bounds,
)


class SpartinaMaskApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def test_mask_preview_returns_png(self) -> None:
        response = self.client.get("/api/scenarios/spartina_change_detection/mask-preview")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assertGreater(len(response.content), 0)

        image = Image.open(io.BytesIO(response.content)).convert("RGBA")
        self.assertEqual(image.size, (1024, 1024))
        alpha_values = image.getchannel("A").getdata()
        self.assertIn(SPARTINA_MASK_ALPHA, alpha_values)

    def test_run_returns_image_overlay_layer(self) -> None:
        response = self.client.post("/api/scenarios/spartina_change_detection/run", json={})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["layers"]), 1)

        layer = body["layers"][0]
        self.assertEqual(layer["layer_type"], "image_overlay")
        self.assertEqual(
            layer["image_url"],
            "/api/scenarios/spartina_change_detection/mask-preview",
        )
        self.assertEqual(layer["bounds"], get_spartina_bounds())
        self.assertEqual(layer["opacity"], 0.55)

    def test_spartina_run_skips_ee_initialization(self) -> None:
        with patch("backend.app.api.routes.authenticate_and_initialize") as auth_mock:
            response = self.client.post("/api/scenarios/spartina_change_detection/run", json={})

        self.assertEqual(response.status_code, 200)
        auth_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
