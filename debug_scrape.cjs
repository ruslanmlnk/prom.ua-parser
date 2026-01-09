
const https = require('https');
const fs = require('fs');

const url = process.argv[2] || 'https://velotrend.com.ua/ua/g121577154-detskoe-tvorchestvo?sort=-date_created';

https.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        fs.writeFileSync('debug_velotrend.html', data);
        console.log('HTML saved to debug_velotrend.html');
    });

}).on('error', (err) => {
    console.error('Error:', err.message);
});
