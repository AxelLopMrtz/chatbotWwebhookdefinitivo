const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require("@whiskeysockets/baileys");
const express = require("express");
const axios = require("axios");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const guardarImagenLocal = require("./guardarImagenLocal");

const app = express();
app.use(express.json());

const AUTH_FOLDER = "baileys_auth";
const processedMessages = new Set();
let sock;

async function deleteSessionFolder() {
  const folderPath = path.join(__dirname, AUTH_FOLDER);
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
    console.log("🧹 Carpeta de sesión eliminada automáticamente.");
  }
}

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📲 Escanea este código QR con tu WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ Conectado a WhatsApp correctamente!");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`🔌 Conexión cerrada. Código: ${statusCode} — ${shouldReconnect ? "Reintentando..." : "Sesión cerrada por usuario."}`);

      if (statusCode === DisconnectReason.loggedOut) {
        await deleteSessionFolder();
        await startSock();
      } else if (shouldReconnect) {
        try {
          await startSock();
        } catch (e) {
          console.error("❌ Error al reconectar:", e.message);
        }
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;

    const remoteJid = m.key.remoteJid;
    const from = remoteJid.replace(/@s\.whatsapp\.net$/, '');
    const isOld = Math.floor(Date.now() / 1000) - m.messageTimestamp > 20;
    const isBroadcast = remoteJid === "status@broadcast";
    const isStub = m.messageStubType || m.message?.protocolMessage;
    const isDuplicate = processedMessages.has(m.key.id);
    const isSpamPush = m.pushName === "WhatsApp";

    if (isOld || isBroadcast || isStub || isDuplicate || isSpamPush) {
      console.log(`🚫 Ignorado mensaje sospechoso o duplicado de ${from}`);
      return;
    }

    processedMessages.add(m.key.id);

    const nombre = m.pushName || 'Desconocido';
    const fechaHora = new Date(m.messageTimestamp * 1000).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      hour12: true
    });

    let texto = '';
    let ubicacion = null;
    let imagen_url = null;

    try {
      if (m.message.conversation || m.message.extendedTextMessage) {
        texto = m.message.conversation || m.message.extendedTextMessage?.text || '';
      } else if (m.message.locationMessage) {
        const lat = m.message.locationMessage.degreesLatitude;
        const lng = m.message.locationMessage.degreesLongitude;
        ubicacion = { latitud: lat, longitud: lng };
        texto = `📍 Ubicación compartida: https://maps.google.com/?q=${lat},${lng}`;
      } else if (m.message.imageMessage) {
        const buffer = await downloadMediaMessage(m, "buffer", {}, { logger: console, reuploadRequest: sock.updateMediaMessage });

        const nombreArchivo = `imagen_${Date.now()}.jpg`;
        imagen_url = guardarImagenLocal(buffer, nombreArchivo);

        texto = m.message.imageMessage.caption || '📷 Imagen recibida';
      }
    } catch (err) {
      console.error("⚠️ Error procesando el contenido multimedia:", err.message);
    }

    if (imagen_url) {
      console.log(`📩 Imagen de ${nombre} (${from}) a las ${fechaHora}: ${texto} (imagen_url: ${imagen_url})`);
    } else {
      console.log(`📩 Mensaje real de ${nombre} (${from}) a las ${fechaHora}: ${texto}`);
    }

    try {
      const payload = {
        from,
        nombre,
        texto,
        fechaHora,
        ...(ubicacion ? { ubicacion } : {}),
        ...(imagen_url ? { imagen_url } : {})
      };

      console.log("🔁 Enviando POST a n8n con:", payload);

      const resp = await axios.post(
        'https://d085-187-190-175-227.ngrok-free.app/webhook/whatsapp', // <-- Cambia aquí si usas ngrok u otra ruta
        payload,
        { headers: { 'Content-Type': 'application/json' } }
      );

      let respuestaTexto;

      if (typeof resp.data === 'object') {
        if (resp.data.respuesta) {
          respuestaTexto = resp.data.respuesta;
        } else if (typeof resp.data.output === 'string') {
          respuestaTexto = resp.data.output;
        } else {
          respuestaTexto = JSON.stringify(resp.data);
        }
      } else if (typeof resp.data === 'string') {
        respuestaTexto = resp.data;
      } else {
        respuestaTexto = '✔️ Recibido';
      }

      await sock.sendMessage(remoteJid, { text: respuestaTexto });

    } catch (err) {
      console.error("❌ Error al enviar al webhook o responder:");
      if (err.response) {
        console.error("🔻 Código:", err.response.status);
        console.error("🔻 Data:", err.response.data);
      } else {
        console.error("🔻 Mensaje:", err.message);
      }
    }
  });
}

startSock();
