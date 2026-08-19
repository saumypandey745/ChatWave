const { OAuth2Client } = require('google-auth-library');

const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const client = new OAuth2Client(googleClientId);

const verifyGoogleIdToken = async (idToken) => {
  if (!idToken) {
    throw new Error('ID Token is required');
  }

  // Handle mock / test environment token
  if (idToken.startsWith('mock-google-token-')) {
    const mockEmail = idToken.replace('mock-google-token-', '');
    return {
      email: mockEmail,
      name: mockEmail.split('@')[0],
      picture: `https://api.dicebear.com/7.x/avataaars/svg?seed=${mockEmail}`,
      sub: `mock-google-id-${mockEmail}`,
    };
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: googleClientId,
    });
    const payload = ticket.getPayload();
    return {
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      sub: payload.sub,
    };
  } catch (error) {
    console.error('Error verifying Google Token:', error.message);
    throw new Error('Invalid Google ID Token');
  }
};

module.exports = {
  client,
  verifyGoogleIdToken,
};
