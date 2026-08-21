const errorHandler = (err, req, res, next) => {
  console.error('[SERVER ERROR]', err.message);
  console.error('[SERVER ERROR stack]', err.stack);

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
    // Temporarily expose stack in production to diagnose the 500 error
    stack: err.stack,
  });
};

module.exports = errorHandler;
