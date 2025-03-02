import { RecognizeResult, RecognizeResultBoundingBox, RecognizeResultLine, RecognizeResultWord } from '../utils/types';
import OcrDriverBase from '../OcrDriverBase';
import Logger from '@joplin/utils/Logger';
import shim from '../../../shim';
import * as fs from 'fs';

const logger = Logger.create('OcrDriverGoogle');

// Google Vision API client setup
interface GoogleCloudCredentials {
    project_id: string;
    client_email: string;
    private_key: string;
}

export default class OcrDriverGoogle extends OcrDriverBase {
    private credentials_: GoogleCloudCredentials;
    private keyFilePath_: string | null = null;

    public constructor(keyFilePath: string) {
        super();
        this.keyFilePath_ = keyFilePath;
        try {
            // Load the credentials from the file
            const credentialsJson = fs.readFileSync(keyFilePath, 'utf8');
            this.credentials_ = JSON.parse(credentialsJson);
            logger.info(`Google OCR driver initialized with project: ${this.credentials_.project_id}`);
        } catch (error) {
            logger.error('Failed to load Google Cloud credentials:', error);
            throw new Error(`Failed to load Google Cloud credentials: ${error.message}`);
        }
    }

    private async requestVisionAPI(imageFilePath: string, language: string): Promise<any> {
        try {
            // Read the image file as base64
            const imageBuffer = await shim.fsDriver().readFile(imageFilePath, 'buffer');
            const imageBase64 = imageBuffer.toString('base64');

            // Prepare the request payload
            const requestBody = {
                requests: [
                    {
                        image: {
                            content: imageBase64
                        },
                        features: [
                            {
                                type: 'DOCUMENT_TEXT_DETECTION', // For handwriting, DOCUMENT_TEXT_DETECTION works better
                                languageHints: [language]
                            }
                        ]
                    }
                ]
            };

            // Prepare the auth header using the service account credentials
            const iat = Math.floor(Date.now() / 1000);
            const exp = iat + 3600; // 1 hour expiration
            
            const payload = {
                iss: this.credentials_.client_email,
                sub: this.credentials_.client_email,
                aud: 'https://vision.googleapis.com/',
                iat: iat,
                exp: exp
            };
            
            // Generate JWT token for auth
            const jwt = await this.generateJWT(payload, this.credentials_.private_key);
            
            // Make the request to the Vision API
            const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${jwt}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Google Vision API failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            logger.error('Error calling Google Vision API:', error);
            throw error;
        }
    }

    // Helper function to generate JWT token
    private async generateJWT(payload: any, privateKey: string): Promise<string> {
        try {
            // Note: In a production environment, you'd use a proper JWT library
            // For simplicity, we're assuming there's a helper method available or using third-party libs
            // This is a simplification and should be replaced with actual JWT generation code
            
            // Simple Base64 encoding for the header and payload
            const header = {
                alg: 'RS256',
                typ: 'JWT'
            };
            
            const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64')
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
            
            const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64')
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
            
            const signatureInput = `${encodedHeader}.${encodedPayload}`;
            
            // In real implementation, you'd sign the input with RS256 using the private key
            // This is a placeholder for actual JWT signature creation
            
            // IMPORTANT: In an actual implementation, you would use a proper JWT library like jsonwebtoken
            // For now, we're using shim to simulate this functionality
            const signature = await shim.cryptoSign(signatureInput, privateKey, 'RS256');
            
            return `${encodedHeader}.${encodedPayload}.${signature}`;
        } catch (error) {
            logger.error('Error generating JWT:', error);
            throw error;
        }
    }

    private convertGoogleResponseToRecognizeResult(googleResponse: any): RecognizeResult {
        try {
            if (!googleResponse?.responses?.[0]?.fullTextAnnotation) {
                // No text found in the image
                return { text: '', lines: [] };
            }

            const annotation = googleResponse.responses[0].fullTextAnnotation;
            const text = annotation.text;
            const lines: RecognizeResultLine[] = [];

            // Process the detailed text annotations
            if (annotation.pages && annotation.pages.length > 0) {
                for (const page of annotation.pages) {
                    for (const block of page.blocks) {
                        for (const paragraph of block.paragraphs) {
                            const lineWords: RecognizeResultWord[] = [];
                            
                            for (const word of paragraph.words) {
                                // Extract the word text
                                let wordText = '';
                                for (const symbol of word.symbols) {
                                    wordText += symbol.text;
                                }
                                
                                // Get bounding box coordinates
                                const vertices = word.boundingBox.vertices;
                                
                                // Convert Google's vertices format to our bounding box format [x0, x1, y0, y1]
                                const bb: RecognizeResultBoundingBox = [
                                    vertices[0].x,  // x0 (left)
                                    vertices[2].x,  // x1 (right)
                                    vertices[0].y,  // y0 (top)
                                    vertices[2].y   // y1 (bottom)
                                ];
                                
                                lineWords.push({
                                    t: wordText,
                                    bb: bb
                                });
                            }
                            
                            if (lineWords.length > 0) {
                                lines.push({ words: lineWords });
                            }
                        }
                    }
                }
            }

            return {
                text: text,
                lines: lines
            };
        } catch (error) {
            logger.error('Error converting Google Vision response:', error);
            throw error;
        }
    }

    public async recognize(language: string, filePath: string): Promise<RecognizeResult> {
        try {
            logger.info(`Recognizing text in ${filePath} with language ${language}`);
            
            const googleResponse = await this.requestVisionAPI(filePath, language);
            const result = this.convertGoogleResponseToRecognizeResult(googleResponse);
            
            logger.info(`Successfully recognized text in ${filePath}`);
            return result;
        } catch (error) {
            logger.error(`Recognition failed for ${filePath}:`, error);
            throw error;
        }
    }

    public async dispose(): Promise<void> {
        // Nothing to dispose for Google Cloud Vision API
        logger.info('Disposing Google OCR driver');
    }
}