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