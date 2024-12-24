const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Branch Schema
const BatchNumberSchema = new Schema(
  {
    Branch: { type: String, required: true },      
    CreationDate: { type: Date, required: true },  
    ExpiryDate: { type: Date, required: true },    
    BatchNumber: { type: String, required: true }, 
    Brand: { type: String, required: true },       
    ProductName: { type: String, required: true }, 
    Volume: { type: String, required: true },     
    Quantity: { type: Number, required: true }
  },
  {
    timestamps: true 
  }
);

// Create the Branch model
const Batch = mongoose.model('BatchNumber', BatchNumberSchema);


module.exports = Batch;
