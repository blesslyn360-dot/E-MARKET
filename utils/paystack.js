async function verifyPaystackTransaction(reference) {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      console.error('PAYSTACK_SECRET_KEY is not configured.');
      return { success: false, message: 'Payment verification is not configured on the server.' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok || !data.status) {
      return { success: false, message: data.message || 'Could not verify transaction.' };
    }

    const transaction = data.data;

    if (transaction.status !== 'success') {
      return { success: false, message: `Transaction status was "${transaction.status}", not successful.` };
    }

    return {
      success: true,
      amount: transaction.amount,
      currency: transaction.currency,
      email: transaction.customer.email,
    };
  } catch (err) {
    if (err.name === 'AbortError') return { success: false, message: 'Payment verification timed out. Please try again.' };
    return { success: false, message: err.message };
  }
}

module.exports = { verifyPaystackTransaction };
