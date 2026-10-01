# AGENTS.md — services/ai/documents

## Purpose

Turning uploaded files into text for the agents. No LLM calls here.

## Contents

- `extract_document_text.py` — PDF (pypdf) and DOCX (python-docx, including table cells) to
  text; raises `UnsupportedDocumentError` for other types or files with no text layer
