const express = require('express');
const fs = require('fs');
const path = require('path');

function setupDownloadRoutes(app) {

  app.get('/download/:fileName', (req, res) => {
    try {
      const fileName = req.params.fileName;
      
      console.log(`Solicitud de descarga: ${fileName}`);
      
      if (!fileName) {
        console.error('Nombre de archivo vacío');
        return res.status(400).json({ 
          error: 'Nombre de archivo requerido',
          ok: false 
        });
      }
      
      if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        console.error('Intento de path traversal detectado');
        return res.status(400).json({ 
          error: 'Nombre de archivo inválido',
          ok: false 
        });
      }
      
      if (!fileName.endsWith('.pdf')) {
        console.error('Tipo de archivo no permitido');
        return res.status(400).json({ 
          error: 'Solo se permiten archivos PDF',
          ok: false 
        });
      }
      const validNamePattern = /^reporte_sacramentos_\d+\.pdf$/;
      if (!validNamePattern.test(fileName)) {
        console.error('Formato de nombre inválido');
        return res.status(400).json({ 
          error: 'Formato de nombre de archivo no válido',
          ok: false 
        });
      }

      const uploadDir = path.join(__dirname, '../Uploads');
      const filePath = path.join(uploadDir, fileName);
      const normalizedPath = path.normalize(filePath);
      const normalizedUploadDir = path.normalize(uploadDir);
      
      if (!normalizedPath.startsWith(normalizedUploadDir)) {
        console.error('Intento de acceso fuera del directorio permitido');
        return res.status(403).json({ 
          error: 'Acceso denegado',
          ok: false 
        });
      }
      
      if (!fs.existsSync(filePath)) {
        console.error(`Archivo no encontrado: ${fileName}`);
        return res.status(404).json({ 
          error: 'Archivo no encontrado o expirado',
          ok: false 
        });
      }
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      const fileSizeKB = (fileSize / 1024).toFixed(2);
      
      console.log(`Enviando archivo: ${fileName} (${fileSizeKB} KB)`);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    
      const fileStream = fs.createReadStream(filePath);
      
      fileStream.on('error', (streamError) => {
        console.error(`Error al leer el archivo: ${streamError.message}`);
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'Error al leer el archivo',
            ok: false 
          });
        }
      });
      
      fileStream.on('end', () => {
        console.log(`Descarga completada: ${fileName}`);
      });
      
      // Enviar el archivo
      fileStream.pipe(res);
      
    } catch (error) {
      console.error(`Error en la descarga del archivo: ${error.message}`);
      console.error(error.stack);
      
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Error interno del servidor al procesar la descarga',
          ok: false 
        });
      }
    }
  });

  
  app.get('/download/check/:fileName', (req, res) => {
    try {
      const fileName = req.params.fileName;
      
      // Validaciones básicas
      if (!fileName || fileName.includes('..') || !fileName.endsWith('.pdf')) {
        return res.status(400).json({ 
          exists: false,
          error: 'Nombre de archivo inválido',
          ok: false 
        });
      }
      
      const filePath = path.join(__dirname, '../Uploads', fileName);
      const exists = fs.existsSync(filePath);
      
      if (exists) {
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        const fileSizeKB = (fileSize / 1024).toFixed(2);
        
        return res.json({ 
          exists: true,
          fileName,
          size: `${fileSizeKB} KB`,
          createdAt: stats.birthtime,
          ok: true
        });
      } else {
        return res.json({ 
          exists: false,
          ok: true
        });
      }
      
    } catch (error) {
      console.error(`Error al verificar archivo: ${error.message}`);
      res.status(500).json({ 
        exists: false,
        error: 'Error al verificar el archivo',
        ok: false 
      });
    }
  });
  
  app.get('/download/list/all', (req, res) => {
    try {
      const uploadDir = path.join(__dirname, '../Uploads');
      
      if (!fs.existsSync(uploadDir)) {
        return res.json({ 
          files: [],
          total: 0,
          ok: true 
        });
      }
      
      const files = fs.readdirSync(uploadDir)
        .filter(file => file.endsWith('.pdf'))
        .map(file => {
          const filePath = path.join(uploadDir, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            size: `${(stats.size / 1024).toFixed(2)} KB`,
            createdAt: stats.birthtime,
            age: Date.now() - stats.birthtimeMs
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt); 
      
      console.log(`Listando ${files.length} archivos disponibles`);
      
      res.json({ 
        files,
        total: files.length,
        ok: true 
      });
      
    } catch (error) {
      console.error(`Error al listar archivos: ${error.message}`);
      res.status(500).json({ 
        error: 'Error al listar archivos',
        ok: false 
      });
    }
  });
  
  app.delete('/download/:fileName', (req, res) => {
    try {
      const fileName = req.params.fileName;
      
      console.log(`Solicitud de eliminación: ${fileName}`);
      
      if (!fileName || fileName.includes('..') || !fileName.endsWith('.pdf')) {
        return res.status(400).json({ 
          error: 'Nombre de archivo inválido',
          ok: false 
        });
      }
      
      const filePath = path.join(__dirname, '../Uploads', fileName);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ 
          error: 'Archivo no encontrado',
          ok: false 
        });
      }
      
      fs.unlinkSync(filePath);
      
      console.log(`Archivo eliminado: ${fileName}`);
      
      res.json({ 
        message: 'Archivo eliminado exitosamente',
        fileName,
        ok: true 
      });
      
    } catch (error) {
      console.error(`Error al eliminar archivo: ${error.message}`);
      res.status(500).json({ 
        error: 'Error al eliminar el archivo',
        ok: false 
      });
    }
  });

}

module.exports = { setupDownloadRoutes };