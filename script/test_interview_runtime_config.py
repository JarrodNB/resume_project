"""Check shipped interview runtime commands receive the read-only database connection."""

import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


class ComposeLoader(yaml.SafeLoader):
    pass


ComposeLoader.add_constructor(
    "!override", lambda loader, node: loader.construct_mapping(node, deep=True)
)


class InterviewRuntimeConfigTest(unittest.TestCase):
    def test_each_runtime_has_reader_credentials(self):
        for filename in [
            "docker-compose.yml",
            "docs/interview-recovery.compose.yml",
            "docs/interview-real-qa.compose.yml",
        ]:
            with self.subTest(filename=filename):
                config = yaml.load((ROOT / filename).read_text(), Loader=ComposeLoader)
                env = config["services"]["ai-http"]["environment"]
                self.assertEqual(env.get("DB_HOST"), "db")
                self.assertEqual(env.get("DB_NAME"), "api_development")
                self.assertEqual(env.get("DB_USERNAME"), "ai_reader")
                self.assertTrue(env.get("DB_PASSWORD"))

    def test_recovery_stack_provisions_reader_before_rails_grants(self):
        config = yaml.load(
            (ROOT / "docs/interview-recovery.compose.yml").read_text(), Loader=ComposeLoader
        )
        self.assertEqual(
            config["services"]["api"]["depends_on"]["reader-setup"]["condition"],
            "service_completed_successfully",
        )
        setup = config["services"]["reader-setup"]
        self.assertEqual(setup["depends_on"]["db"]["condition"], "service_healthy")
        self.assertIn("/reader.sql", setup["command"])
        self.assertTrue(
            any("ensure_interview_reader.sql:/reader.sql:ro" in value for value in setup["volumes"])
        )


if __name__ == "__main__":
    unittest.main()
