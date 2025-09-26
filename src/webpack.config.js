const path = require('path');

new CspHtmlWebpackPlugin(
    {
        'default-src': [
            "'self'"
        ],
        'script-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'style-src': ["'self'"],
    },
    {
        enabled: true,
        nonceEnabled: {
            'style-src': true,
            'script-src': true,
        },
    }
)

const customConfig = {
    'stats': {
        'errorDetails': true,
        'children': true
    }
}

module.exports = {
 module: {
   rules: [
     {
       test: /\.txt/,
       type: 'asset/resource'
     }
   ]
 }
}