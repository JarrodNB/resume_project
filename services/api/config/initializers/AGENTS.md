# AGENTS.md — services/api/config/initializers

## Purpose

Authentication, queue wiring, usage limits, text caps, and middleware initializers.

## Contents

- `ai_usage_limits.rb`
- `career_library_embeddings.rb`
- `cors.rb`
- `devise.rb`
- `filter_parameter_logging.rb`
- `inflections.rb`
- `rack_attack.rb`
- `shoryuken.rb`
- `text_limits.rb`

## Local Rules

TextLimits::INTERVIEW_ANSWER is 2,000 and must match Python and web caps. Keep defaults and credentials separate; secrets come from the environment.
