# Nostr-WebRTC Signaling Spec (Tag-based v0.2)

## Event Kinds

- **5010** — webrtc_offer

- **5011** — webrtc_answer

- **5012** — ice_candidate All events MUST be signed by the sender’s Nostr key. All signaling data SHOULD be NIP-04 or NIP-44 encrypted between peers.

## Event Structure

```json
{
"kind": <number>,
"content": "",
"tags": [["p", "<peer_pubkey>"], ...],
"created_at": <unix_timestamp>
}
--- ## Tags per Kind ### 5010 — WebRTC Offer
["p", "<receiver_pubkey>"]
["session", "<random_session_id>"]
["sdp", "<base64_or_plain_sdp>"]
```

### 5011 — WebRTC Answer

```json
["p", "<receiver_pubkey>"]
["session", "<same_session_id>"]
["ref", "<offer_event_id>"]
["sdp", "<base64_or_plain_sdp>"]
```

### 5012 — ICE Candidate

```json
["p", "<receiver_pubkey>"]
["session", "<same_session_id>"]
["ref", "<offer_event_id>"]
["candidate", "<base64_or_plain_candidate>"]
```

## Flow Summary

1.  Requester → Sender: publish webrtc_offer (5010)

2.  Sender → Requester: reply with webrtc_answer (5011)

3.  Both exchange ice_candidate (5012)

4.  Once ICE completes → WebRTC DataChannel established

# Spec: Nostr-Powered P2P File Sharing (Demo Version)

## 1️⃣ Overview

Users can expose selected files from their browser. Anyone can discover the files and request them. File transfer happens via WebRTC DataChannel. File lists are replaceable events — users can update/remove files.

## Event Types

A. File List Event
Kind: 10020
Purpose: announce files a user is sharing (replaceable)

Structure:

```json
{ "kind": 10020, "pubkey": "<peer-pubkey>", "created_at": <unix-timestamp>, "tags": [ ["file", "<public-filename>", "<optional-metadata-json>"], ... ], "content": "", // optional extra metadata or description
"id": "<event-id>", "sig": "<signature>" }
```

Example tags:

```json
[
  ["file", "example.pdf", "{\"size\":123456,\"mime\":\"application/pdf\"}"],
  ["file", "photo.jpg", "{\"size\":234567,\"mime\":\"image/jpeg\"}"]
]
```

## WebRTC Signaling Events Offer:

kind 5010 Answer: kind 5011 ICE candidate: kind 5012 Tags:

Tag Description

```json
["p", "<peer-pubkey>"] target peer ["session", "<session-id>"] session identifier ["sdp", "<base64-or-json-sdp>"] SDP (offer/answer) ["candidate", "<base64-or-json-candidate>"]
```

// ICE candidate

## Flow

1.  Peer B sees Peer A’s file list → wants a file.

2.  Peer B sends WebRTC offer via Nostr events (kind 5010).
3.  Peer A responds with answer (5011).
4.  Both exchange ICE candidates (5012).
5.  DataChannel opens → file sent.
