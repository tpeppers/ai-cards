# Card Recognition ML System

YOLOv8-powered playing card detection for the Hearts game app.

## Quick Start

```bash
# 1. Install Python dependencies
npm run ml:install

# 2. Prepare dataset (copy images from pix/ to train/val splits)
npm run ml:prepare

# 3. Annotate images using Label Studio (see below)

# 4. Train the model
npm run ml:train

# 5. Start the inference server
npm run ml:server
```

## Directory Structure

```
ml/
├── data/
│   ├── images/train/     # Training images (80%)
│   ├── images/val/       # Validation images (20%)
│   ├── labels/train/     # YOLO format labels for training
│   ├── labels/val/       # YOLO format labels for validation
│   └── dataset.yaml      # YOLOv8 dataset configuration
├── models/               # Trained model weights
├── scripts/
│   ├── prepare_dataset.py   # Data preparation
│   ├── train.py             # Model training
│   └── predict.py           # Test inference
├── server/
│   └── inference_server.py  # FastAPI service (port 3002)
└── requirements.txt
```

## Alpha Encoding

Cards are encoded as single letters matching `src/urlGameState.js`:

| Suit     | Ranks (A-K) | Alpha   | Class IDs |
|----------|-------------|---------|-----------|
| Hearts   | A-K         | a-m     | 0-12      |
| Spades   | A-K         | n-z     | 13-25     |
| Clubs    | A-K         | A-M     | 26-38     |
| Diamonds | A-K         | N-Z     | 39-51     |

Example: `abcNOP` = Ace/2/3 of Hearts + Ace/2/3 of Diamonds

## Annotation with Label Studio

### Install Label Studio

```bash
pip install label-studio
```

### Start Label Studio

```bash
label-studio start
```

Open http://localhost:8080 in your browser.

### Create Project

1. Click "Create Project"
2. Name: "Card Recognition"
3. Import images from `ml/data/images/train/`

### Configure Labeling Interface

Use this labeling config (Object Detection with Bounding Boxes):

```xml
<View>
  <Image name="image" value="$image"/>
  <RectangleLabels name="label" toName="image">
    <Label value="hearts_A" background="#ff6b6b"/>
    <Label value="hearts_2" background="#ff6b6b"/>
    <Label value="hearts_3" background="#ff6b6b"/>
    <Label value="hearts_4" background="#ff6b6b"/>
    <Label value="hearts_5" background="#ff6b6b"/>
    <Label value="hearts_6" background="#ff6b6b"/>
    <Label value="hearts_7" background="#ff6b6b"/>
    <Label value="hearts_8" background="#ff6b6b"/>
    <Label value="hearts_9" background="#ff6b6b"/>
    <Label value="hearts_10" background="#ff6b6b"/>
    <Label value="hearts_J" background="#ff6b6b"/>
    <Label value="hearts_Q" background="#ff6b6b"/>
    <Label value="hearts_K" background="#ff6b6b"/>
    <Label value="spades_A" background="#333333"/>
    <Label value="spades_2" background="#333333"/>
    <Label value="spades_3" background="#333333"/>
    <Label value="spades_4" background="#333333"/>
    <Label value="spades_5" background="#333333"/>
    <Label value="spades_6" background="#333333"/>
    <Label value="spades_7" background="#333333"/>
    <Label value="spades_8" background="#333333"/>
    <Label value="spades_9" background="#333333"/>
    <Label value="spades_10" background="#333333"/>
    <Label value="spades_J" background="#333333"/>
    <Label value="spades_Q" background="#333333"/>
    <Label value="spades_K" background="#333333"/>
    <Label value="clubs_A" background="#4a9eff"/>
    <Label value="clubs_2" background="#4a9eff"/>
    <Label value="clubs_3" background="#4a9eff"/>
    <Label value="clubs_4" background="#4a9eff"/>
    <Label value="clubs_5" background="#4a9eff"/>
    <Label value="clubs_6" background="#4a9eff"/>
    <Label value="clubs_7" background="#4a9eff"/>
    <Label value="clubs_8" background="#4a9eff"/>
    <Label value="clubs_9" background="#4a9eff"/>
    <Label value="clubs_10" background="#4a9eff"/>
    <Label value="clubs_J" background="#4a9eff"/>
    <Label value="clubs_Q" background="#4a9eff"/>
    <Label value="clubs_K" background="#4a9eff"/>
    <Label value="diamonds_A" background="#ffa500"/>
    <Label value="diamonds_2" background="#ffa500"/>
    <Label value="diamonds_3" background="#ffa500"/>
    <Label value="diamonds_4" background="#ffa500"/>
    <Label value="diamonds_5" background="#ffa500"/>
    <Label value="diamonds_6" background="#ffa500"/>
    <Label value="diamonds_7" background="#ffa500"/>
    <Label value="diamonds_8" background="#ffa500"/>
    <Label value="diamonds_9" background="#ffa500"/>
    <Label value="diamonds_10" background="#ffa500"/>
    <Label value="diamonds_J" background="#ffa500"/>
    <Label value="diamonds_Q" background="#ffa500"/>
    <Label value="diamonds_K" background="#ffa500"/>
  </RectangleLabels>
</View>
```

### Annotate Images

1. Draw bounding boxes around each visible card
2. Select the correct label (e.g., "hearts_A" for Ace of Hearts)
3. Submit and continue to next image

### Export Annotations

1. Go to Export in Label Studio
2. Select "YOLO" format
3. Export to `ml/data/labels/train/`
4. Repeat for validation images

## Training

### Basic Training

```bash
npm run ml:train
```

### Custom Training Options

```bash
cd ml/scripts
python train.py --epochs 150 --batch 16 --model l --device 0
```

Options:
- `--epochs`: Number of training epochs (default: 100)
- `--batch`: Batch size (default: 8)
- `--imgsz`: Image size (default: 1280)
- `--model`: YOLOv8 size - n/s/m/l/x (default: m)
- `--device`: GPU device or 'cpu' (default: 0)
- `--resume`: Resume from last checkpoint

### Training Tips

- Start with 15-20 labeled images for a bootstrap model
- Use the bootstrap model's predictions to speed up labeling remaining images
- More diverse training images = better generalization
- Cards at different angles, lighting, and backgrounds help

## Inference Server

### Start Server

```bash
npm run ml:server
```

Server runs on `http://localhost:3002`

### API Endpoints

#### POST /recognize

Recognize cards in an uploaded image.

```bash
curl -X POST -F "image=@path/to/image.jpg" http://localhost:3002/recognize
```

Response:
```json
{
  "success": true,
  "hand": "abcNOP",
  "cards": [
    {"alpha": "a", "suit": "hearts", "rank": 1, "confidence": 0.95},
    {"alpha": "b", "suit": "hearts", "rank": 2, "confidence": 0.92}
  ],
  "processingTimeMs": 150
}
```

#### GET /health

Check server and model status.

```bash
curl http://localhost:3002/health
```

## Integration with Express Server

The Node.js server at port 3001 proxies requests to the ML service:

```bash
# Test via Express (recommended)
curl -X POST -F "image=@pix/IMG_3873.JPG" http://localhost:3001/api/recognize

# Check ML service status
curl http://localhost:3001/api/recognize/health
```

## Adding More Training Data

1. Add new images to `pix/` folder
2. Run `npm run ml:prepare` to split into train/val
3. Use Label Studio with model-assisted pre-annotation
4. Export labels and retrain with `npm run ml:train`
5. Restart inference server to load new model

## Troubleshooting

### CUDA out of memory
- Reduce batch size: `--batch 4`
- Use smaller model: `--model s`

### Poor accuracy
- Add more diverse training images
- Ensure bounding boxes are tight around cards
- Check for mislabeled images
- Train for more epochs

### Model not loading
- Ensure `ml/models/card_detector_best.pt` exists
- Train a model first with `npm run ml:train`
