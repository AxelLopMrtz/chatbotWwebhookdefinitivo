const fs = require("fs");
const path = require("path");

function guardarImagenLocal(buffer, nombreArchivo) {
  const rutaCarpeta = path.join(__dirname, "evidencias");

  if (!fs.existsSync(rutaCarpeta)) {
    fs.mkdirSync(rutaCarpeta);
  }

  const rutaCompleta = path.join(rutaCarpeta, nombreArchivo);
  fs.writeFileSync(rutaCompleta, buffer);

  // ✅ Usa la IP que te dio http-server, NO localhost
  const IP_LOCAL = '192.168.100.242'; // <-- IP de tu red local
  const puerto = 3001;

  return `http://${IP_LOCAL}:${puerto}/${nombreArchivo}`;
}

module.exports = guardarImagenLocal;
