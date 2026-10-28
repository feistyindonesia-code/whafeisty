import { Router } from 'express';
import multer from 'multer';
import { AccountModel } from '../../services/database/models';
import { jwtAuth, customerOnly, AuthRequest } from '../../middleware/jwt';
import { checkSubscription } from '../../middleware/subscription';
import { identifyMedia, resolveAccountMedia, saveAccountMedia } from '../../services/media/storage';
import { Response } from 'express';
import { ApiResponse } from '../../types';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024, files: 1 },
});
const receiveUpload = (req: AuthRequest, res: Response, next: (error?: unknown) => void) => {
  upload.single('file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ success: false, error: 'Media upload exceeds the 16 MiB size limit' });
      return;
    }
    res.status(400).json({ success: false, error: 'Invalid media upload' });
  });
};

router.post('/', jwtAuth, customerOnly, checkSubscription, receiveUpload, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const media = identifyMedia(req.file.buffer);
    if (!media || req.file.mimetype !== media.mimeType) {
      return res.status(400).json({ success: false, error: 'File content is not a supported media type or does not match its declared MIME type' });
    }

    const accounts = await AccountModel.findByUserId(req.user.id);
    const account = accounts[0];
    if (!account) {
      return res.status(403).json({ success: false, error: 'No account found' });
    }

    const saved = await saveAccountMedia(account.id, req.file.buffer, media);
    res.status(201).json({
      success: true,
      data: {
        media_id: saved.mediaId,
        size: req.file.size,
        mimetype: media.mimeType,
      },
    });
  } catch (error) {
    console.error('Error uploading media:', error);
    res.status(500).json({ success: false, error: 'Failed to upload media' });
  }
});

router.get('/download/:mediaId', jwtAuth, customerOnly, async (req: AuthRequest, res: Response) => {
  try {
    const accounts = await AccountModel.findByUserId(req.user.id);
    const account = accounts[0];
    if (!account) {
      return res.status(403).json({ success: false, error: 'No account found' });
    }

    const filePath = await resolveAccountMedia(account.id, req.params.mediaId);
    if (!filePath) {
      return res.status(404).json({ success: false, error: 'Media not found' });
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(filePath, req.params.mediaId, (error) => {
      if (error && !res.headersSent) {
        console.error('Error downloading media:', error);
        res.status(500).json({ success: false, error: 'Failed to download media' });
      }
    });
  } catch (error) {
    console.error('Error resolving media:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch media' });
  }
});

export default router;
