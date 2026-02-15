## Development Setup

### Prerequisites
- Node.js and npm
- Xcode (for iOS development)
- Python 3 (for testing)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Install Python testing dependencies:
```bash
pip install -r requirements.txt
```

### Running the Applications

#### Start both web app and API server:
```bash
npm run dev
```

#### Start individually:
```bash
# Web application only (port 3000)
npm start

# API server only (port 3001)  
npm run server
```
### API Endpoints

- `POST /api/upload` - Upload card hand images
- `GET /api/upload/:uuid` - Get upload details by UUID
- `GET /api/uploads` - List all uploads
- `GET /ios/download` - Download compiled iOS app
- `GET /health` - Server health check

## ALTERNATIVE ENCODINGS:
TODO: Integrate PHH file format: https://arxiv.org/html/2312.11753v5 

Here are the SHIFT+CTRL-U+1F0[A-D]X codes:	
Unicode 	|  1    2   3   4   5  6   7  8   9  A   B   C   D
U+1F0Ax	    |  🂡	🂢	🂣	🂤	🂥	🂦	🂧	🂨	🂩	🂪	🂫	🂭	🂮
U+1F0Bx	    |  🂱	🂲	🂳	🂴	🂵	🂶	🂷	🂸	🂹	🂺	🂻	🂽	🂾
U+1F0Cx	    |  🃁	🃂	🃃	🃄	🃅	🃆	🃇	🃈	🃉	🃊	🃋	🃍	🃎
U+1F0Dx	    |  🃑	🃒	🃓	🃔	🃕	🃖	🃗	🃘	🃙	🃚	🃛	🃝	🃞

Note the as-of-yet unused KNIGHTS ("cavalier") available in unicode: 🂬🂼🃌🃜 which might be interesting for testing.

Curious if an ad-hoc token-schema performs better or worse than unicode encoding, i.e., asking a model what card to play, after prompting with an entire set of rules, would cause it to pick well?