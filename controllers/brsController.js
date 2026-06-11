import BankReconciliation from '../models/BankReconciliation.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'brs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

export const upload = multer({ storage });

// Upload bank statement
export const uploadStatement = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { bankName } = req.body;
    const brs = new BankReconciliation({
      fileName: req.file.originalname,
      filePath: req.file.path,
      fileType: req.file.mimetype,
      bankName,
      uploadedBy: req.user._id,
      status: 'Pending'
    });

    await brs.save();
    res.status(201).json({ success: true, data: brs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all statements
export const getStatements = async (req, res) => {
  try {
    const statements = await BankReconciliation.find().sort({ createdAt: -1 });
    res.json({ success: true, data: statements });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get statement by ID
export const getStatementById = async (req, res) => {
  try {
    const statement = await BankReconciliation.findById(req.params.id);
    if (!statement) {
      return res.status(404).json({ success: false, message: 'Statement not found' });
    }
    res.json({ success: true, data: statement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Reconcile statement
export const reconcileStatement = async (req, res) => {
  try {
    const { matchedEntries, notes } = req.body;
    const statement = await BankReconciliation.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          matchedEntries,
          notes,
          status: 'Reconciled'
        }
      },
      { new: true }
    );
    if (!statement) {
      return res.status(404).json({ success: false, message: 'Statement not found' });
    }
    res.json({ success: true, data: statement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
