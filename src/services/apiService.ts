import axios from 'axios';
import { GenDownloadResponse } from '../types';

export const fetchDownloadLinks = async (videoUrl: string): Promise<GenDownloadResponse> => {
  try {
    // Gọi qua Backend của bạn (/api/download) để ẩn API Key và tránh lỗi CORS
    const response = await axios.post<GenDownloadResponse>('/api/download', {
      url: videoUrl
    });
    return response.data;
  } catch (error) {
    return {
      success: false,
      error: 'Không thể kết nối đến máy chủ hoặc link không hợp lệ.'
    };
  }
};
