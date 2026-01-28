# Use this code snippet in your app.
# If you need more information about configurations
# or implementing the sample code, visit the AWS docs:
# https://aws.amazon.com/developer/language/python/
import json
import os
import boto3
from botocore.exceptions import ClientError


def get_secret(secret_name):

    # secret_name = "dev_mongo_credentials"
    region_name = "eu-west-2"

    # Create a Secrets Manager client
    session = boto3.session.Session()
    client = session.client(
        service_name='secretsmanager',
        region_name=region_name
    )

    try:
        get_secret_value_response = client.get_secret_value(
            SecretId=secret_name
        )
    except ClientError as e:
        # For a list of exceptions thrown, see
        # https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
        print(e)
        raise e

    secret = get_secret_value_response['SecretString']
    print(type(secret))
    print(secret)
    secret = json.loads(secret)

    for k, v in secret.items(): os.environ[k] = v

if __name__ == '__main__':
    get_secret("anthropic_api_key")
    os.get('anthropic')