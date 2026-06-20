# Lambda container image for PDF -> Word conversion (arm64 / Graviton).
FROM public.ecr.aws/lambda/python:3.12-arm64

# opencv (pulled in by pdf2docx) needs libGL at runtime.
RUN dnf install -y mesa-libGL && dnf clean all

COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY lambda_function.py ${LAMBDA_TASK_ROOT}/

CMD [ "lambda_function.handler" ]
