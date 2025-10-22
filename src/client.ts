// src/client.ts
import {
  getEventHash,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  Relay,
  Event,
  EventTemplate,
  UnsignedEvent,
} from "nostr-tools";

export const RELAY_URL = "wss://relay.primal.net";
export const kindOffer = 5010;
export const kindAnswer = 5011;
export const kindIce = 5012;

export let sk: Uint8Array;
export let pk: string;
let relay: Relay;
let pc: RTCPeerConnection;
let dataChannel: RTCDataChannel | null = null;

const log = (m: string) => {
  const el = document.getElementById("log")!;
  el.innerHTML += `<div>${m}</div>`;
  el.scrollTop = el.scrollHeight;
};

// Initialize Relay
export async function initRelay() {
  try {
    relay = await Relay.connect(RELAY_URL);
    log("✅ Connected to relay");
    subscribeRelay();
  } catch (err) {
    log("⚠️ Failed to connect: " + err);
  }
}

// Subscribe to signaling events
async function subscribeRelay() {
  const sub = relay.subscribe([{ kinds: [kindOffer, kindAnswer, kindIce] }], {
    onevent: handleEvent,
  });
}

// Key generation
export function generateKeys() {
  sk = generateSecretKey();
  pk = getPublicKey(sk);
  const pubEl = document.getElementById("pubkey")!;
  pubEl.textContent = pk;
  log("Generated keypair");
}

// WebRTC Peer setup
function createPeer(
  initiator: boolean,
  targetPubkey: string,
  sessionId: string
): RTCPeerConnection {
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      {
        urls: "turn:numb.viagenie.ca",
        username: "webrtc@live.com",
        credential: "muazkh",
      },
    ],
  });

  if (initiator) {
    dataChannel = pc.createDataChannel("chat");
    setupDataChannel();
  } else {
    pc.ondatachannel = (e) => {
      dataChannel = e.channel;
      setupDataChannel();
    };
  }

  pc.onicecandidate = async (e) => {
    if (e.candidate) {
      await publishSignaling(kindIce, targetPubkey, sessionId, {
        ref: sessionId,
        candidate: btoa(JSON.stringify(e.candidate)),
      });
    }
  };

  return pc;
}

function setupDataChannel() {
  if (!dataChannel) return;
  dataChannel.onopen = () => log("📡 Data channel open");
  dataChannel.onmessage = (e) => log("Peer: " + e.data);
}

// Publish signaling events
async function publishSignaling(
  kind: number,
  peer: string,
  sessionId: string,
  data: { sdp?: string; candidate?: string; ref?: string }
) {
  const tags: string[][] = [
    ["p", peer],
    ["session", sessionId],
  ];
  if (data.ref) tags.push(["ref", data.ref]);
  if (data.sdp) tags.push(["sdp", data.sdp]);
  if (data.candidate) tags.push(["candidate", data.candidate]);

  const event: UnsignedEvent = {
    kind,
    pubkey: pk,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };

  const signedEvent = finalizeEvent(event, sk);
  await relay.publish(signedEvent);
}

// Start a session as initiator
export async function startSession(targetPubkey: string) {
  const sessionId = crypto.randomUUID();
  createPeer(true, targetPubkey, sessionId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  console.log("Offer SDP:", offer.sdp);
  await publishSignaling(kindOffer, targetPubkey, sessionId, {
    sdp: btoa(offer.sdp!),
  });
  log("📨 Offer sent to " + targetPubkey);
}

// Handle incoming signaling events
async function handleEvent(event: Event) {
  const tags: Record<string, string> = Object.fromEntries(
    event.tags.map((t) => [t[0], t[1]])
  );
  if (tags.p !== pk) return;

  if (event.kind === kindOffer) {
    log("📥 Received offer from " + event.pubkey);
    createPeer(false, event.pubkey, tags.session);
    const sdp = atob(tags.sdp);
    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log("Answer SDP:", answer.sdp);
    await publishSignaling(kindAnswer, event.pubkey, tags.session, {
      ref: event.id,
      sdp: btoa(answer.sdp!),
    });
    log("📨 Sent answer");
  }

  if (event.kind === kindAnswer && pc) {
    const sdp = atob(tags.sdp);
    await pc.setRemoteDescription({ type: "answer", sdp });
    log("✅ Connection established");
  }

  if (event.kind === kindIce && pc) {
    const cand = JSON.parse(atob(tags.candidate));
    await pc.addIceCandidate(cand);
  }
}

// Send message over DataChannel
export function sendMessage(msg: string) {
  if (dataChannel?.readyState === "open") {
    dataChannel.send(msg);
    log("You: " + msg);
  } else {
    log("⚠️ Data channel not open");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("genKey")!.onclick = () => generateKeys();
  document.getElementById("start")!.onclick = () => {
    const peerPub = (
      document.getElementById("peerPub") as HTMLInputElement
    ).value.trim();
    if (peerPub) startSession(peerPub);
  };
  document.getElementById("send")!.onclick = () => {
    const msg = (document.getElementById("msg") as HTMLInputElement).value;
    sendMessage(msg);
  };

  initRelay();
});
