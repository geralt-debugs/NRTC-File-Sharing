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
import { v4 as uuidv4 } from "uuid";
import iceServers from "./servers.json";

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

let receivedFileName: string | null = null;

// File list management
let advertisedFiles: { name: string; metadata?: string; file: File }[] = [];

export function advertiseFiles(
  files: { name: string; metadata?: string; file: File }[]
) {
  advertisedFiles = files;
  publishFileList();
}

async function publishFileList() {
  const tags = advertisedFiles.map((file) => [
    "file",
    file.name,
    file.metadata || "",
  ]);
  const event: UnsignedEvent = {
    kind: 10020,
    pubkey: pk,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  const signedEvent = finalizeEvent(event, sk);
  await relay.publish(signedEvent);
}

async function handleFileListEvent(event: Event) {
  if (event.kind !== 10020) return;
  // Update UI or internal state with advertised files
  const files = event.tags
    .filter((tag) => tag[0] === "file")
    .map((tag) => ({ name: tag[1], metadata: tag[2] }));
  log(
    `📁 Files advertised by ${event.pubkey}: ${files
      .map((f) => f.name)
      .join(", ")}`
  );

  // Update UI component to show files as clickable list for requesting
  const advertisedFilesContainer = document.getElementById("advertisedFiles");
  if (!advertisedFilesContainer) return;

  files.forEach((file) => {
    const fileElem = document.createElement("div");
    fileElem.textContent = `${file.name} by ${event.pubkey}`;
    fileElem.style.cursor = "pointer";
    fileElem.style.padding = "5px";
    fileElem.style.border = "1px solid #ccc";
    fileElem.style.margin = "2px 0";
    fileElem.title = "Click to request this file";

    fileElem.onclick = () => {
      requestFile(event.pubkey, file.name);
    };

    advertisedFilesContainer.appendChild(fileElem);
  });
}

// Request a file from a peer
function requestFile(peerPubkey: string, filename: string) {
  if (!dataChannel || dataChannel.readyState !== "open") {
    log("⚠️ Data channel not open for file request");
    return;
  }
  const requestMsg = JSON.stringify({ type: "file_request", filename });
  dataChannel.send(requestMsg);
  log(`📨 Requested file: ${filename} from ${peerPubkey}`);
  receivedFileName = filename;
}

async function subscribeRelay() {
  const sub = relay.subscribe(
    [{ kinds: [kindOffer, kindAnswer, kindIce, 10020] }],
    {
      onevent: (event) => {
        handleEvent(event);
        handleFileListEvent(event);
      },
    }
  );
}

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
    iceServers,
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
  dataChannel.onmessage = (e) => {
    log("Peer: " + e.data);
    handleDataChannelMessage(e.data);
  };
}

// Handle messages received over DataChannel
function handleDataChannelMessage(message: any) {
  if (typeof message === "string") {
    try {
      const msgObj = JSON.parse(message);
      if (msgObj.type === "file_request") {
        log(`📥 File request received for: ${msgObj.filename}`);
        sendFile(msgObj.filename);
      } else if (msgObj.type === "file_end") {
        finalizeReceivedFile();
      }
    } catch {
      log("⚠️ Invalid JSON message received: " + message);
    }
  } else if (message instanceof ArrayBuffer) {
    if (!receivingFile) {
      receivingFile = true;
      receivedBuffers = [];
    }
    receivedBuffers.push(message);
    log(`📥 Received chunk (${receivedBuffers.length})`);
  }
}

// File sending state
let fileReader: FileReader | null = null;
let currentFile: File | null = null;
let chunkSize = 16 * 1024; // 16 KB
let offset = 0;

function sendFile(filename: string) {
  if (!dataChannel || dataChannel.readyState !== "open") {
    log("⚠️ Data channel not open for sending file");
    return;
  }
  const fileEntry = advertisedFiles.find((f) => f.name === filename);
  if (!fileEntry) {
    log(`⚠️ File not found: ${filename}`);
    return;
  }
  if (!fileEntry.metadata) {
    log(`⚠️ No file data available for: ${filename}`);
    return;
  }
  const fileData = fileEntry.file;
  if (!fileData) {
    log(`⚠️ No file object found in metadata for: ${filename}`);
    return;
  }
  currentFile = fileData;
  offset = 0;
  fileReader = new FileReader();
  fileReader.onload = (e) => {
    if (!e.target?.result) return;
    // Send raw ArrayBuffer data directly over DataChannel without JSON.stringify
    dataChannel!.send(e.target.result as ArrayBuffer);
    offset += chunkSize;
    if (offset < currentFile!.size) {
      readSlice(offset);
    } else {
      // Send a simple JSON message to indicate file end
      dataChannel!.send(JSON.stringify({ type: "file_end" }));
      log(`📤 File sent: ${filename}`);
      currentFile = null;
      fileReader = null;
    }
  };
  readSlice(0);
}

function readSlice(o: number) {
  const slice = currentFile!.slice(o, o + chunkSize);
  fileReader!.readAsArrayBuffer(slice);
}

// Receiving file state
let receivingFile = false;
let receivedBuffers: ArrayBuffer[] = [];

// function handleDataChannelMessage(message: any) {
//   if (typeof message === "string") {
//     try {
//       const msgObj = JSON.parse(message);
//       if (msgObj.type === "file_request") {
//         log(`📥 File request received for: ${msgObj.filename}`);
//         sendFile(msgObj.filename);
//       } else if (msgObj.type === "file_end") {
//         finalizeReceivedFile();
//       }
//     } catch {
//       log("⚠️ Invalid JSON message received: " + message);
//     }
//   } else if (message instanceof ArrayBuffer) {
//     if (!receivingFile) {
//       receivingFile = true;
//       receivedBuffers = [];
//     }
//     receivedBuffers.push(message);
//     log(`📥 Received chunk (${receivedBuffers.length})`);
//   }
// }

function finalizeReceivedFile() {
  const blob = new Blob(receivedBuffers);
  receivedBuffers = [];
  receivingFile = false;
  const url = URL.createObjectURL(blob);
  log(`✅ File received. Download link: ${url}`);
  const a = document.createElement("a");
  a.href = url;
  a.download = receivedFileName || "downloaded_file"; // Could be improved to preserve original filename
  a.textContent = "Download received file";
  document.body.appendChild(a);
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
  const sessionId = uuidv4();
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
