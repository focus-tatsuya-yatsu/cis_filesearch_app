# Dockerfile for Image Embedding Lambda Function
# Uses AWS Lambda Python 3.11 base image with ML libraries

FROM public.ecr.aws/lambda/python:3.11

# Install system dependencies
RUN yum install -y \
    gcc \
    gcc-c++ \
    make \
    libgomp \
    && yum clean all

# Copy requirements
COPY requirements.txt ${LAMBDA_TASK_ROOT}/

# Install Python dependencies
# Use --no-cache-dir to reduce image size
RUN pip install --no-cache-dir -r requirements.txt

# Download and cache the CLIP model during build (optional but recommended)
# This significantly speeds up cold starts
RUN python -c "from transformers import CLIPModel, CLIPProcessor; \
    model_name='openai/clip-vit-base-patch32'; \
    CLIPModel.from_pretrained(model_name); \
    CLIPProcessor.from_pretrained(model_name); \
    print('Model cached successfully')"

# Copy function code
COPY handler.py ${LAMBDA_TASK_ROOT}/

# Set the CMD to your handler
CMD [ "handler.lambda_handler" ]
