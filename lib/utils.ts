import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


export function imgArrayToJson<T>(arr: T[], keyPrefix: string = 'image'): Record<string, T> {
  return Object.fromEntries(
    arr.map((value, index) => [`${keyPrefix}${index + 1}`, value])
  );
}


export function jsonToImgArray<T>(json: Record<string, T>, keyPrefix: string = 'image'): T[] {
  const result: T[] = [];
  let index = 1;
  
  while (true) {
    const key = `${keyPrefix}${index}`;
    if (key in json) {
      result.push(json[key]);
      index++;
    } else {
      break;
    }
  }
  
  return result;
}