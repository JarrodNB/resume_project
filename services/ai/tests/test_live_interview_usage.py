"""Turn LiveKit's running live-session usage into priced heartbeat deltas (no LiveKit session)."""

from livekit.agents.metrics import LLMModelUsage, STTModelUsage

from live_interviews.usage import LiveUsageTotals, heartbeat_usage

REALTIME = "gpt-realtime-2.1-mini"
TRANSCRIBE = "gpt-live-transcribe"


def totals(*model_usage):
    return LiveUsageTotals.from_model_usage(list(model_usage), realtime_model=REALTIME, transcription_model=TRANSCRIBE)


def realtime(**counts):
    return LLMModelUsage(provider="api.openai.com", model=REALTIME, **counts)


def test_realtime_audio_and_text_tokens_are_priced_by_kind_with_cached_reads_split_out():
    usage = totals(realtime(input_tokens=3_000, input_cached_tokens=1_000, input_text_tokens=1_000, input_cached_text_tokens=600,
                            input_audio_tokens=2_000, input_cached_audio_tokens=400, output_tokens=700, output_text_tokens=200,
                            output_audio_tokens=500))
    assert heartbeat_usage(usage, LiveUsageTotals()) == [{
        "model": REALTIME, "input_tokens": 3_000, "cached_input_tokens": 1_000, "output_tokens": 700,
        # 400 text x $0.60 + 600 cached text x $0.06 + 1,600 audio x $10 + 400 cached audio x $0.30
        # + 200 text out x $2.40 + 500 audio out x $20, per million tokens
        "cost_microdollars": 26_876,
    }]


def test_deltas_report_only_what_is_new_since_the_last_acknowledged_totals():
    first = totals(realtime(input_tokens=1_000, input_audio_tokens=1_000, output_tokens=100, output_audio_tokens=100))
    second = totals(realtime(input_tokens=1_500, input_audio_tokens=1_500, output_tokens=100, output_audio_tokens=100),
                    STTModelUsage(provider="api.openai.com", model=TRANSCRIBE, audio_duration=12.5))
    assert heartbeat_usage(second, first) == [
        {"model": REALTIME, "input_tokens": 500, "cached_input_tokens": 0, "output_tokens": 0, "cost_microdollars": 5_000},
        # $0.017 a minute of audio, rounded up
        {"model": TRANSCRIBE, "audio_milliseconds": 12_500, "cost_microdollars": 3_542},
    ]
    assert heartbeat_usage(second, second) == []


def test_usage_without_a_known_price_keeps_its_tokens_but_no_cost():
    image = totals(realtime(input_tokens=50, input_image_tokens=50))
    assert heartbeat_usage(image, LiveUsageTotals()) == [
        {"model": REALTIME, "input_tokens": 50, "cached_input_tokens": 0, "output_tokens": 0}]
    other_model = totals(LLMModelUsage(provider="api.openai.com", model="gpt-realtime-9", input_tokens=10))
    assert heartbeat_usage(other_model, LiveUsageTotals()) == [
        {"model": REALTIME, "input_tokens": 10, "cached_input_tokens": 0, "output_tokens": 0}]
    token_transcription = totals(STTModelUsage(provider="api.openai.com", model=TRANSCRIBE, input_tokens=30, output_tokens=5))
    assert heartbeat_usage(token_transcription, LiveUsageTotals()) == [{"model": TRANSCRIBE, "input_tokens": 30, "output_tokens": 5}]


def test_totals_add_up_and_a_cost_is_reported_for_the_trace():
    usage = totals(realtime(input_tokens=1_000, input_audio_tokens=1_000))
    assert usage.cost_microdollars() == 10_000
    assert LiveUsageTotals().cost_microdollars() == 0
