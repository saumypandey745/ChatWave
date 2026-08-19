const errorHandler = (err, req, res, next) => {
  console.error('[SERVER ERROR]', err.message);

  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;

  // Enforce CORS headers on all error responses
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    errors: err.errors || null,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};

module.exports = errorHandler;
