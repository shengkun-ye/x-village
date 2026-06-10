export default function handler(req, res) {
  res.json({ proxy: true, hasKey: Boolean(process.env.MONID_API_KEY) });
}
