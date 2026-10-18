# AI interview practice: competitors, video, and implementation tradeoffs

Research date: 2026-10-18. This note uses first-party product documentation and pricing pages. Product descriptions are vendor claims about features, not independent evidence that they improve hiring outcomes. Prices are in USD and can change.

## What “video interview” actually means

Separate four capabilities when comparing products:

1. **Spoken practice:** the user speaks; transcription or a voice model supports questions and feedback.
2. **Camera recording:** the user can watch their own recording afterward. This does not establish that AI analyzes images.
3. **Visual feedback:** software analyzes appearance-related signals such as framing or estimated camera engagement.
4. **Video interviewer:** an animated or video-presented AI asks questions. This does not require sending the user's camera to the AI.

These are independent product choices. The surveyed products demonstrate several combinations; this sample does not establish market share or that most products require video analysis.

## Competitor findings

| Product | Practice experience and personalization | What video contributes | Public price/access checked |
| --- | --- | --- | --- |
| **Yoodli** | Role/company-specific questions, selectable interviewer demeanor, and follow-up questions based on answers. | Microphone is the minimum requirement. Optional camera enables feedback on body language and centering; release notes explicitly describe computer-vision eye-contact and visual-presence feedback. | Starter: five lifetime sessions. Pro: $8/month billed annually, up to ten roleplays/week. Advanced: $20/month billed annually, unlimited roleplays. [Practice guide](https://support.yoodli.ai/en/articles/9550465-practice-with-yoodli), [release notes](https://support.yoodli.ai/en/articles/9048809-yoodli-release-notes), [pricing](https://yoodli.ai/pricing). |
| **Huru** | Users choose a role or paste a job description, record answers, then receive scores and suggested improvements after each answer. | Records answers on camera for playback. Current documentation emphasizes answer relevance, structure, specificity, impact, and articulation; camera recording alone does not substantiate automated facial-expression analysis. | Its current About page says all features became free for individuals on September 28, 2026; enterprise plans remain. [About](https://huru.ai/about/), [product and recording workflow](https://huru.ai/). |
| **Big Interview — PracticeAI** | Dynamic questions based on a mandatory job description and optional resume; answer-level feedback, transcript, and an improved sample answer. | Explicitly **audio-only**; no camera required for this feature. | Institution-specific licensing and session allowances. It is a separate feature from VideoAI. [PracticeAI help](https://support.biginterview.com/en/article/practiceai-qxju4/). |
| **Big Interview — VideoAI** | Record answers, save/upload them, then receive analysis. Responses must last at least 30 seconds; processing can take a few minutes. | Actual recorded-video feedback, including engagement-pattern analysis described in its FAQ. | Optional paid upgrade for institutions. Individual product pricing separately lists $39/month, $99/three months, or $299 lifetime; do not assume those prices establish institutional AI-feature entitlements. [Processing requirements](https://support.biginterview.com/en/article/videoai-feedback-9vhrsb/), [VideoAI FAQ](https://support.biginterview.com/en/article/videoai-feedback-faq-k8t2ds/), [personal pricing](https://www.biginterview.com/pricing/personal). |
| **Final Round AI — practice interviews** | Practice begins from a job-specific goal/scenario; the user answers questions out loud. | Video-presented AI interviewer and optional private self-view. Its documentation explicitly says the interviewer never receives the user's camera and practice is driven by voice. | Homepage advertises Pro from $25+/month including practice; exact billing term needs checkout confirmation. Subscription documentation says running practice requires a subscription. [Practice flow](https://docs.finalroundai.com/docs/mock-interviews/starting-a-mock), [video window](https://docs.finalroundai.com/docs/mock-interviews/mock-video-window), [homepage](https://www.finalroundai.com/), [subscription access](https://docs.finalroundai.com/docs/getting-started/subscribe-and-plans). |
| **Google Interview Warmup — historical reference** | Google's 2022 launch describes spoken-answer transcription, repeated-word insights, job terminology, and talking-point coverage, without grading answers. | The launch describes a speech/text experience rather than visual assessment. | Treat this as a historical design example: the old product URL redirected to a general interview-tips article during this research, so current standalone availability was not verified. [Launch announcement](https://blog.google/company-news/outreach-and-initiatives/grow-with-google/interview-warmup/), [current redirect destination](https://grow.google/grow-your-career/articles/interview-tips/). |

**Employer-side comparison:** HireVue's 2024 explainability statement describes transcription followed by language analysis and competency scoring. It explicitly excludes visual analysis and vocal characteristics such as tone from that assessment. A recorded video interview therefore need not mean image-based candidate scoring. This is a hiring-assessment product, unlike private candidate coaching. [HireVue explainability statement](https://www.hirevue.com/wp-content/uploads/2024/09/HV_2024_AI-Explainability-Statement.pdf).

## What Careergrind can learn

These are product recommendations inferred from the comparison, not vendor-established facts:

- Make the primary value concrete: questions grounded in the saved job, resume, and career examples, useful follow-ups, and actionable feedback after practice.
- Voice practice can deliver that loop without visual analysis. Big Interview explicitly sells an audio-only practice mode, while Final Round separates interviewer video from the user's private camera preview.
- Optional camera recording offers rehearsal and self-review. Automated visual feedback is a separate feature requiring its own evidence of usefulness and quality checks.
- Keep coaching feedback about observable answer quality. Do not present a confidence score or facial behavior as proof of job suitability.
- Competitor subscriptions cover entire products and bundles. They are willingness-to-pay references, not estimates of our infrastructure cost.

## Source freshness and limits

Huru's current first-party About page says it became free on September 28, 2026. Search results still expose older $24.99/month and $99/year pricing; this report uses the dated current announcement. Big Interview's current VideoAI FAQ says eye-tracking calibration is no longer required, superseding an older student guide that still instructs users to calibrate. [Huru About](https://huru.ai/about/), [current VideoAI FAQ](https://support.biginterview.com/en/article/videoai-feedback-faq-k8t2ds/).

No paid accounts were created and no competitor sessions were run. The report establishes documented features, not firsthand latency, feedback quality, or interview-outcome improvements.


## Costs: separate recording, conversation, visual analysis, and avatars

All figures below are USD, checked 18 October 2026. These are component estimates, not complete operating costs. Taxes, engineering, support, base plans, retries, and final coaching are extra unless explicitly included. No paid API experiments were run.

| Component | Published rate / explicit assumption | Illustrative cost |
| --- | --- | --- |
| Transcribe recorded answers | OpenAI lists mini transcription at approximately $0.003/min and full transcription at $0.006/min | 20 minutes submitted: $0.06–$0.12, plus text coaching |
| Native live voice, new audio only | Realtime mini: $10/M input and $20/M output audio tokens; full: $32/M and $64/M | With 12 minutes of user speech and 3 minutes of AI speech in a 20-minute session: approximately $0.144 mini or $0.461 full, before history, text, transcription, and coaching |
| Managed live-agent hosting | LiveKit Ship: $50/month with 5,000 agent minutes, then $0.01/min | At the overage rate, 20 agent minutes = $0.20; model inference, other media meters, and recording are separate |
| Managed video recording | LiveKit Ship composite-video export overage: $0.02/min | 20 minutes = $0.40 beyond the allowance; raw-track export is a different, cheaper meter |
| Talking video avatar | Tavus displays conversation overages of $0.26–$0.35/min, depending on plan | 20 minutes = $5.20–$7.00 at those overage rates, plus the plan; included conversation pipeline already covers its LLM, speech, and WebRTC |

Rate sources: [official OpenAI pricing](https://developers.openai.com/api/docs/pricing), [LiveKit pricing](https://livekit.com/pricing), [Tavus pricing](https://www.tavus.io/pricing). Tavus's retrieved page contains inconsistent plan tables (including different included-minute allowances); treat its displayed overages as indicative and confirm the actual checkout terms before choosing it. Do not add a second voice-model bill to its bundled pipeline unless deliberately using separately billed services.

The live-voice calculation uses 600 input audio tokens/minute and 1,200 output tokens/minute. Realtime also bills conversation history on later turns, with caching affecting the result; input transcription is an additional charge if enabled. The table's audio figure is therefore a starting component, not a session quote. [Official OpenAI voice cost documentation](https://developers.openai.com/api/docs/guides/voice-latency-cost?voice-api=realtime)

For a 20-minute recording at an **assumed total bitrate of 1–2 Mbps**, arithmetic gives approximately 150–300 MB. A 1,000-recording batch occupies about 150–300 GB before additional versions. At an **illustrative storage assumption of $0.023/GB-month**, that is roughly $3.45–$6.90/month for one retained batch. This is a planning assumption, not a verified quote for Careergrind's deployment region. Playback bandwidth, requests, backups, and processing are extra; retained batches accumulate. Use the chosen region's [S3 pricing](https://aws.amazon.com/s3/pricing/) for deployment estimates.

Visual AI has no single meaningful per-interview price without specifying the model, resolution, and sampling. Sampling every five seconds produces 240 images for 20 minutes; every second produces 1,200. Those are design examples, not validated sampling recommendations. Sparse images can help inspect framing but miss motion and timing. Browser-side landmark processing could reduce provider usage, but still needs implementation and validation. Neither recording video nor displaying an avatar inherently requires analyzing the user's face.

## Technical difficulty and product risks

The following are engineering assessments, informed by the cited platform behavior rather than measured implementation estimates.

1. **Recorded answers: moderate difficulty.** Browser capture requires permission and a secure context; unavailable or busy devices need clear recovery. Test supported recording containers/codecs at runtime and normalize only when necessary. Build short recording chunks, upload recovery, duration limits, and playback on the target browser matrix. [Capture requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [recording codec/container behavior](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/mimeType)
2. **Live voice: high difficulty.** Handle thinking pauses, interruptions, echo, noisy microphones, disconnects, and reconnecting without duplicated questions or lost answers. Endpointing mistakes are especially noticeable when someone pauses to formulate an interview answer. A managed WebRTC platform reduces infrastructure work, but NAT/firewall traversal can require TURN relays. Measure time to first audio, false interruptions, and completion rates on real networks. [WebRTC TURN documentation](https://webrtc.org/getting-started/turn-server)
3. **Live avatar: additional cost and dependencies.** Budget for session concurrency, provider startup time, lip synchronization, disconnect cleanup, and vendor outages. Prototype whether the face improves practice enough to justify the recurring cost. Realism is a product hypothesis, not demonstrated learning value in this research.
4. **Visual feedback: hardest to validate.** Camera placement, lighting, glasses, movement, cultural differences, and disability complicate interpretation. Keep any camera coaching specific and optional; evaluate it with consented, varied recordings. Avoid presenting gaze, facial expression, or delivery style as a reliable measure of honesty, personality, or hiring suitability. HireVue's own explanation separates language assessment from those visual and vocal signals. [HireVue explanation](https://www.hirevue.com/wp-content/uploads/2024/09/HV_2024_AI-Explainability-Statement.pdf)
5. **Feedback needs different evidence.** A transcript can support coaching on answer relevance, structure, and missing examples. It does not reliably preserve pauses, vocal delivery, or every filler word. Timing metrics need aligned timestamps or audio measurements; visual coaching needs video evidence. Let users correct transcription errors before content feedback is treated as authoritative.
6. **Media lifecycle is ongoing work.** Specify recording consent, retention, private playback, deletion including derived files, provider logging, and recovery from partial uploads. Keep media out of ordinary application logs and traces. Enforce per-user quotas and hard session timeouts server-side so abandoned sessions cannot keep spending.

## Fit with Careergrind and recommended sequence

Careergrind already has saved general, technical, and knowledge question sets, revision-bound written answers, and queued AI coaching. The existing docs explicitly say there is no saved-job targeting. This recommendation is a proposal, not an accepted architecture decision. [Current interview architecture](../architecture/interview-prep.md), [service ownership](../architecture.md)

1. **First release: spoken answers with optional camera recording and replay.** Reuse the existing question sets. Rails authorizes private media uploads and owns recording/answer state. Send object references through SQS; Python extracts/transcribes audio and returns results through the existing result queue. Show a transcript for correction before requesting the existing feedback. Bind media, transcript, and feedback to the appropriate question/answer revisions; duplicate jobs must not create duplicate attempts or costs unnecessarily. Default to audio-only uploads or local camera replay if persistent video is not needed.
2. **Next: interview sessions with follow-up questions and a final debrief.** Start with clear answer submission boundaries if that meets the need. Evaluate question relevance, factual grounding, and whether users improve across attempts. Saved-job tailoring needs explicit scope because it is not part of current generation.
3. **Then: natural live voice if users need it.** A queue is suitable for post-answer processing but cannot provide a responsive bidirectional conversation. A live AI-service runtime and authenticated streaming transport would require an explicit architecture change to the current queue-only rule. Preserve Rails ownership and queued durable post-session coaching; define authorization, usage metering, reconnection, and persistence before implementation. Do not route every speech chunk through SQS.
4. **Only after validation: avatar and optional visual coaching.** Evaluate these independently. An avatar can be shown while processing only audio; a user's video can be recorded for replay without an avatar or visual inference.

The strongest initial differentiation is personalized, grounded coaching using the user's career library and saved practice history. Whether video improves retention or interview outcomes remains an experiment; vendor marketing is not evidence of that outcome.
