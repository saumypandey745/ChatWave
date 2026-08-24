const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    contactUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    nickname: {
      type: String,
      default: '',
      trim: true,
      maxLength: 50,
    },
  },
  {
    timestamps: true,
  }
);

contactSchema.index({ ownerId: 1, contactUserId: 1 }, { unique: true });

module.exports = mongoose.model('Contact', contactSchema);
