const express = require('express');
const fs = require('fs');
const path = require('path');

function setupDownloadRoutes(app) {

  app.get('/download/:fileName', (req, res) => {
    try {
      const fileName = req.params.fileName;
      
      if (!fileName || fileName.includes('..') || !fileName.endsWith('.pdf')) {
        return res.status(400).send('Nombre de archivo inválido');
      }
      
      // Construir la ruta
      const filePath = path.join(__dirname, '../Uploads', fileName);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).send('Archivo no encontrado');
      }
      
      // Encabezados para la descarga
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      
      // Enviar el archivo como descarga
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      
    } catch (error) {
      console.error(`Error en la descarga del archivo: ${error.message}`);
      res.status(500).send('Error al descargar el archivo');
    }
  });
}

module.exports = { setupDownloadRoutes };