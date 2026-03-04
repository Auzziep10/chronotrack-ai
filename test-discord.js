const url = 'https://discord.com/api/webhooks/1467925353598156948/qjqlsugadqvi81x_WBqdrswFDX-qBMgsHI3rkOQ2Tz9qw_anVC_kueLXZqtMm2vnSD6B';
fetch(url, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content: 'Test Ping' })
})
    .then(res => console.log('Status:', res.status, res.statusText))
    .catch(err => console.error('Fetch Error:', err));
